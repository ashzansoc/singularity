const express = require('express');
const admin = require('firebase-admin');
const { onRequest } = require('firebase-functions/v2/https');
const semver = require('semver');

admin.initializeApp();

const app = express();

async function readManifest() {
	const bucket = admin.storage().bucket();
	const file = bucket.file('releases/current.json');
	const [exists] = await file.exists();
	if (!exists) {
		return null;
	}
	const [contents] = await file.download();
	return JSON.parse(contents.toString('utf8'));
}

function resolvePlatformAsset(manifest, platform) {
	const platforms = manifest.platforms || {};
	return platforms[platform] || platforms['darwin'] || platforms['darwin-arm64'];
}

/**
 * VS Code / Electron compatible update endpoint.
 * GET /api/update/:platform/:quality/:commit
 */
app.get('/api/update/:platform/:quality/:commit', async (req, res) => {
	try {
		const manifest = await readManifest();
		if (!manifest?.commit) {
			return res.status(204).send();
		}

		const clientCommit = req.params.commit;
		if (clientCommit === manifest.commit) {
			return res.status(204).send();
		}

		const platform = req.params.platform;
		const asset = resolvePlatformAsset(manifest, platform);
		const zipUrl = asset?.zip;
		if (!zipUrl) {
			return res.status(204).send();
		}

		return res.json({
			url: zipUrl,
			name: manifest.latestVersion,
			version: manifest.commit,
			productVersion: manifest.latestVersion,
		});
	} catch (err) {
		console.error('update check failed', err);
		return res.status(500).json({ error: 'update check failed' });
	}
});

/**
 * Mandatory-update manifest consumed by the Singularity app on startup.
 * GET /api/releases/manifest.json
 */
app.get('/api/releases/manifest.json', async (_req, res) => {
	try {
		const manifest = await readManifest();
		if (!manifest) {
			return res.status(404).json({ error: 'no release published' });
		}
		res.set('Cache-Control', 'no-store');
		return res.json(manifest);
	} catch (err) {
		console.error('manifest fetch failed', err);
		return res.status(500).json({ error: 'manifest fetch failed' });
	}
});

/**
 * Admin publish endpoint — protect with Firebase Auth or a shared secret in production.
 * POST /api/admin/publish
 * Body: full manifest JSON (see releases/current.json)
 */
app.post('/api/admin/publish', express.json({ limit: '1mb' }), async (req, res) => {
	const secret = process.env.SINGULARITY_PUBLISH_SECRET;
	if (!secret || req.headers['x-singularity-secret'] !== secret) {
		return res.status(401).json({ error: 'unauthorized' });
	}

	const manifest = req.body;
	if (!manifest?.latestVersion || !manifest?.minSupportedVersion || !manifest?.commit) {
		return res.status(400).json({ error: 'invalid manifest' });
	}

	if (!semver.valid(manifest.latestVersion) || !semver.valid(manifest.minSupportedVersion)) {
		return res.status(400).json({ error: 'versions must be semver' });
	}

	try {
		const bucket = admin.storage().bucket();
		await bucket.file('releases/current.json').save(JSON.stringify(manifest, null, 2), {
			contentType: 'application/json',
			metadata: { cacheControl: 'no-store' },
		});
		return res.json({ ok: true, published: manifest.latestVersion, commit: manifest.commit });
	} catch (err) {
		console.error('publish failed', err);
		return res.status(500).json({ error: 'publish failed' });
	}
});

exports.api = onRequest({ cors: true }, app);
