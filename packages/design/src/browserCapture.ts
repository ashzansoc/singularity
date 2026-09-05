/**
 * Browser capture port for visual QA.
 * Production wires Playwright / IDE browser tools; tests use stubs.
 */

export interface ViewportSize {
  width: number;
  height: number;
  name?: string;
}

/** Default viewports for visual evaluation. */
export const DEFAULT_VISUAL_VIEWPORTS: ViewportSize[] = [
  { width: 1440, height: 900, name: 'desktop' },
  { width: 1024, height: 768, name: 'laptop' },
  { width: 390, height: 844, name: 'mobile' },
];

export interface BrowserCaptureRequest {
  /** Dev server or file URL. */
  url: string;
  viewports?: ViewportSize[];
  /** Optional path to navigate after load. */
  path?: string;
  /** Wait for selector before screenshot. */
  waitForSelector?: string;
  timeoutMs?: number;
}

export interface BrowserCapture {
  url: string;
  viewport: ViewportSize;
  screenshotPath?: string;
  screenshotBase64?: string;
  consoleErrors: string[];
  runtimeErrors: string[];
  domSummary?: string;
  title?: string;
}

export interface BrowserPort {
  /**
   * Ensure the app is built/served and capture screenshots + errors.
   * Implementations may shell out to Playwright or IDE tools.
   */
  capture(req: BrowserCaptureRequest): Promise<BrowserCapture[]>;
  /** Optional: start/stop local preview. */
  ensurePreview?(opts: { cwd: string; command?: string }): Promise<{ url: string }>;
}

/**
 * Stub browser port for unit tests — returns empty screenshots with optional injected errors.
 */
export class StubBrowserPort implements BrowserPort {
  constructor(
    private readonly opts: {
      consoleErrors?: string[];
      runtimeErrors?: string[];
      title?: string;
      domSummary?: string;
      screenshotBase64?: string;
    } = {},
  ) {}

  async capture(req: BrowserCaptureRequest): Promise<BrowserCapture[]> {
    const viewports = req.viewports?.length
      ? req.viewports
      : DEFAULT_VISUAL_VIEWPORTS;
    const url = req.path ? new URL(req.path, req.url).toString() : req.url;
    return viewports.map((viewport) => ({
      url,
      viewport,
      screenshotBase64: this.opts.screenshotBase64,
      consoleErrors: this.opts.consoleErrors ?? [],
      runtimeErrors: this.opts.runtimeErrors ?? [],
      domSummary: this.opts.domSummary ?? 'stub-dom',
      title: this.opts.title ?? 'Stub Preview',
    }));
  }
}

/**
 * Playwright-backed BrowserPort. Uses dynamic import so playwright is optional.
 * Returns empty captures (with a note in domSummary) if playwright is missing
 * or the preview URL does not respond.
 */
export class PlaywrightBrowserPort implements BrowserPort {
  constructor(private readonly opts: { screenshotDir?: string } = {}) {}

  async capture(req: BrowserCaptureRequest): Promise<BrowserCapture[]> {
    const viewports = req.viewports?.length
      ? req.viewports
      : DEFAULT_VISUAL_VIEWPORTS;
    const url = req.path ? new URL(req.path, req.url).toString() : req.url;
    const timeoutMs = req.timeoutMs ?? 20_000;

    let playwright: {
      chromium: {
        launch: (opts?: { headless?: boolean }) => Promise<{
          newPage: (opts?: { viewport?: { width: number; height: number } }) => Promise<{
            on: (event: string, handler: (...args: unknown[]) => void) => void;
            goto: (url: string, opts?: { waitUntil?: string; timeout?: number }) => Promise<unknown>;
            waitForSelector: (sel: string, opts?: { timeout?: number }) => Promise<unknown>;
            title: () => Promise<string>;
            content: () => Promise<string>;
            screenshot: (opts?: { path?: string; fullPage?: boolean }) => Promise<Buffer>;
            close: () => Promise<void>;
          }>;
          close: () => Promise<void>;
        }>;
      };
    };
    try {
      const load = new Function('id', 'return import(id)') as (id: string) => Promise<typeof playwright>;
      playwright = await load('playwright');
    } catch {
      return viewports.map((viewport) => ({
        url,
        viewport,
        consoleErrors: [],
        runtimeErrors: [],
        domSummary: 'playwright-unavailable',
        title: 'Playwright unavailable',
      }));
    }

    const browser = await playwright.chromium.launch({ headless: true });
    const captures: BrowserCapture[] = [];
    try {
      for (const viewport of viewports) {
        const page = await browser.newPage({
          viewport: { width: viewport.width, height: viewport.height },
        });
        const consoleErrors: string[] = [];
        const runtimeErrors: string[] = [];
        page.on('console', (...args: unknown[]) => {
          const msg = args[0] as { type?: () => string; text?: () => string };
          if (msg?.type?.() === 'error') consoleErrors.push(String(msg.text?.() ?? '').slice(0, 400));
        });
        page.on('pageerror', (...args: unknown[]) => {
          runtimeErrors.push(String(args[0]).slice(0, 400));
        });
        try {
          await page.goto(url, { waitUntil: 'networkidle', timeout: timeoutMs });
          if (req.waitForSelector) {
            await page.waitForSelector(req.waitForSelector, { timeout: 5000 }).catch(() => {});
          }
          const title = await page.title();
          const html = await page.content();
          const name = viewport.name ?? `${viewport.width}x${viewport.height}`;
          let screenshotPath: string | undefined;
          let screenshotBase64: string | undefined;
          if (this.opts.screenshotDir) {
            const { mkdirSync } = await import('node:fs');
            const { join } = await import('node:path');
            mkdirSync(this.opts.screenshotDir, { recursive: true });
            screenshotPath = join(this.opts.screenshotDir, `${name}.png`);
            await page.screenshot({ path: screenshotPath, fullPage: false });
          } else {
            screenshotBase64 = (await page.screenshot({ fullPage: false })).toString('base64');
          }
          const text = html
            .replace(/<script[\s\S]*?<\/script>/gi, ' ')
            .replace(/<style[\s\S]*?<\/style>/gi, ' ')
            .replace(/<[^>]+>/g, ' ')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 2000);
          captures.push({
            url,
            viewport,
            screenshotPath,
            screenshotBase64,
            consoleErrors,
            runtimeErrors,
            title,
            domSummary: `title=${title}; ${text}`,
          });
        } catch (err) {
          captures.push({
            url,
            viewport,
            consoleErrors,
            runtimeErrors: [...runtimeErrors, err instanceof Error ? err.message : String(err)],
            domSummary: 'capture-failed',
            title: 'Capture failed',
          });
        } finally {
          await page.close().catch(() => {});
        }
      }
    } finally {
      await browser.close().catch(() => {});
    }
    return captures;
  }
}

/** Prefer Playwright when available; otherwise Stub. */
export async function createBrowserPort(opts?: {
  screenshotDir?: string;
  forceStub?: boolean;
}): Promise<BrowserPort> {
  if (opts?.forceStub) return new StubBrowserPort();
  try {
    const load = new Function('id', 'return import(id)') as (id: string) => Promise<unknown>;
    await load('playwright');
    return new PlaywrightBrowserPort({ screenshotDir: opts?.screenshotDir });
  } catch {
    return new StubBrowserPort();
  }
}

/**
 * Heuristic "build readiness" check from workspace files (no real browser).
 * Used when BrowserPort is unavailable — critic still runs on DOM/error stubs.
 */
export function inferPreviewUrl(workspaceFiles: string[]): string | undefined {
  const hasNext = workspaceFiles.some((f) => /next\.config\./.test(f));
  const hasVite = workspaceFiles.some((f) => /vite\.config\./.test(f));
  if (hasNext || hasVite) return 'http://127.0.0.1:3000';
  if (workspaceFiles.some((f) => f.endsWith('index.html'))) {
    return 'http://127.0.0.1:5173';
  }
  return undefined;
}
