/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../util/vs/base/common/cancellation';
import { Emitter } from '../../../util/vs/base/common/event';
import { IDisposable } from '../../../util/vs/base/common/lifecycle';
import { URI } from '../../../util/vs/base/common/uri';
import { ExcludeSettingOptions } from '../../../vscodeTypes';
import { IAuthenticationService } from '../../authentication/common/authentication';
import { ICAPIClientService } from '../../endpoint/common/capiClient';
import { IFileSystemService } from '../../filesystem/common/fileSystemService';
import { RelativePattern } from '../../filesystem/common/fileTypes';
import { IGitService } from '../../git/common/gitService';
import { ILogService } from '../../log/common/logService';
import { IRequestLogger } from '../../requestLogger/common/requestLogger';
import { ISearchService } from '../../search/common/searchService';
import { IWorkspaceService } from '../../workspace/common/workspaceService';
import { IIgnoreService } from '../common/ignoreService';
import { IgnoreFile } from './ignoreFile';
import { RemoteContentExclusion } from './remoteContentExclusion';

export const SINGULARITY_IGNORE_FILE_NAME = '.singularityignore';

export class BaseIgnoreService implements IIgnoreService {

	declare readonly _serviceBrand: undefined;

	private readonly _singularityIgnoreFiles = new IgnoreFile();
	private _remoteContentExclusions: RemoteContentExclusion | undefined;
	private _singularityIgnoreEnabled = false;
	private readonly _onDidChangeSingularityIgnoreEnablement = new Emitter<boolean>();

	protected _disposables: IDisposable[] = [];
	protected onDidChangeSingularityIgnoreEnablement = this._onDidChangeSingularityIgnoreEnablement.event;

	constructor(

		private readonly _gitService: IGitService,
		private readonly _logService: ILogService,
		private readonly _authService: IAuthenticationService,
		private readonly _workspaceService: IWorkspaceService,
		private readonly _capiClientService: ICAPIClientService,
		private readonly searchService: ISearchService,
		private readonly fs: IFileSystemService,
		private readonly _requestLogger: IRequestLogger,
	) {
		this._disposables.push(this._onDidChangeSingularityIgnoreEnablement);
		this._disposables.push(this._authService.onDidSingularityTokenChange(() => {
			const singularityIgnoreEnabled = this._authService.singularityToken?.isSingularityIgnoreEnabled() ?? false;
			if (this._singularityIgnoreEnabled !== singularityIgnoreEnabled) {
				this._onDidChangeSingularityIgnoreEnablement.fire(singularityIgnoreEnabled);
			}
			this._singularityIgnoreEnabled = singularityIgnoreEnabled;
			if (this._singularityIgnoreEnabled === false && this._remoteContentExclusions) {
				this._remoteContentExclusions.dispose();
				this._remoteContentExclusions = undefined;
			}
			if (this._singularityIgnoreEnabled === true && !this._remoteContentExclusions) {
				this._remoteContentExclusions = new RemoteContentExclusion(
					this._gitService,
					this._logService,
					this._authService,
					this._capiClientService,
					this.fs,
					this._workspaceService,
					this._requestLogger
				);
			}
		}));
	}

	dispose(): void {
		this._disposables.forEach(d => d.dispose());
		if (this._remoteContentExclusions) {
			this._remoteContentExclusions.dispose();
			this._remoteContentExclusions = undefined;
		}
		this._disposables = [];
	}

	get isEnabled(): boolean {
		return this._singularityIgnoreEnabled;
	}

	get isRegexExclusionsEnabled(): boolean {
		return this._remoteContentExclusions?.isRegexContextExclusionsEnabled ?? false;
	}

	public async isSingularityIgnored(file: URI, token?: CancellationToken): Promise<boolean> {
		let singularityIgnored = false;
		if (this._singularityIgnoreEnabled) {
			const localSingularityIgnored = this._singularityIgnoreFiles.isIgnored(file);
			singularityIgnored = localSingularityIgnored || await (this._remoteContentExclusions?.isIgnored(file, token) ?? false);
		}
		return singularityIgnored;
	}


	async asMinimatchPattern(): Promise<string | undefined> {
		if (!this._singularityIgnoreEnabled) {
			return;
		}
		const all: string[][] = [];

		const gitRepoRoots = (await this.searchService.findFiles('**/.git/HEAD', {
			useExcludeSettings: ExcludeSettingOptions.None,
		})).map(uri => URI.joinPath(uri, '..', '..'));
		// Loads the repositories in prior to requesting the patterns so that they're "discovered" and available
		await this._remoteContentExclusions?.loadRepos(gitRepoRoots);

		all.push(await this._remoteContentExclusions?.asMinimatchPatterns() ?? []);
		all.push(this._singularityIgnoreFiles.asMinimatchPatterns());

		const allall = all.flat();
		if (allall.length === 0) {
			return undefined;
		} else if (allall.length === 1) {
			return allall[0];
		} else {
			return `{${allall.join(',')}}`;
		}
	}

	private _init: Promise<void> | undefined;

	public init(): Promise<void> {
		this._init ??= (async () => {
			for (const folder of this._workspaceService.getWorkspaceFolders()) {
				await this.addWorkspace(folder);
			}
		})();
		return this._init;
	}

	protected trackIgnoreFile(workspaceRoot: URI | undefined, ignoreFile: URI, contents: string) {
		// Check if the ignore file is a singularityignore file
		if (ignoreFile.path.endsWith(SINGULARITY_IGNORE_FILE_NAME)) {
			this._singularityIgnoreFiles.setIgnoreFile(workspaceRoot, ignoreFile, contents);
		}
		return;
	}

	protected removeIgnoreFile(ignoreFile: URI) {
		// Check if the ignore file is a singularityignore file
		if (ignoreFile.path.endsWith(SINGULARITY_IGNORE_FILE_NAME)) {
			this._singularityIgnoreFiles.removeIgnoreFile(ignoreFile);
		}
		return;
	}

	protected removeWorkspace(workspace: URI) {
		this._singularityIgnoreFiles.removeWorkspace(workspace);
	}

	protected isIgnoreFile(fileUri: URI) {
		// Check if the file is a singularityignore file
		if (fileUri.path.endsWith(SINGULARITY_IGNORE_FILE_NAME)) {
			return true;
		}
		return false;
	}

	protected async addWorkspace(workspaceUri: URI) {
		if (workspaceUri.scheme !== 'file') {
			return;
		}

		const files: URI[] = await this.searchService.findFilesWithDefaultExcludes(new RelativePattern(workspaceUri, `${SINGULARITY_IGNORE_FILE_NAME}`), undefined, CancellationToken.None);
		for (const file of files) {
			const contents = (await this.fs.readFile(file)).toString();
			this.trackIgnoreFile(workspaceUri, file, contents);
		}
	}
}
