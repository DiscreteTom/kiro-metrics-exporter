import * as vscode from 'vscode';
import { MetricsService } from './metricsService';

export class MetricsExporterProvider implements vscode.TreeDataProvider<ConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConfigItem | undefined | null | void> = new vscode.EventEmitter<ConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private context: vscode.ExtensionContext,
        private metricsService: MetricsService
    ) {}

    /**
     * Get extension version from package.json
     */
    private getExtensionVersion(): string {
        const extension = vscode.extensions.getExtension('undefined_publisher.kiro-metrics-exporter');
        if (extension) {
            return extension.packageJSON.version || 'unknown';
        }
        return 'unknown';
    }

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConfigItem): Thenable<ConfigItem[]> {
        if (!element) {
            // Root level items - version info + 3 steps
            const version = this.getExtensionVersion();
            const versionItem = new ConfigItem(
                `📊 Kiro Metrics Exporter v${version}`,
                vscode.TreeItemCollapsibleState.None,
                'version-info'
            );
            versionItem.description = '';
            
            return Promise.resolve([
                versionItem,
                new ConfigItem(
                    '📋 Step 1: AWS Credentials',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'step1-credentials'
                ),
                new ConfigItem(
                    '👤 Step 2: User Identity',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'step2-identity'
                ),
                new ConfigItem(
                    '📦 Step 3: S3 Configuration',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'step3-s3'
                ),
                new ConfigItem(
                    '📝 Step 4: Logs & Settings',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'step4-logs'
                )
            ]);
        } else if (element.id === 'step1-credentials') {
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const accessKey = config.get<string>('aws.accessKey', '');
            const secretKey = config.get<string>('aws.secretKey', '');
            const identityStoreId = config.get<string>('aws.identityStoreId', '');
            const identityStoreRegion = config.get<string>('aws.identityStoreRegion', 'us-east-1');
            
            return Promise.resolve([
                new ConfigItem(
                    `Access Key: ${accessKey ? '***' + accessKey.slice(-4) : 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'access-key',
                    { command: 'metricsExporter.setAccessKey', title: 'Set Access Key', arguments: [] }
                ),
                new ConfigItem(
                    `Secret Key: ${secretKey ? '***' + secretKey.slice(-4) : 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'secret-key',
                    { command: 'metricsExporter.setSecretKey', title: 'Set Secret Key', arguments: [] }
                ),
                new ConfigItem(
                    `Identity Store ID: ${identityStoreId || 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'identity-store-id',
                    { command: 'metricsExporter.setIdentityStoreId', title: 'Set Identity Store ID', arguments: [] }
                ),
                new ConfigItem(
                    `Identity Store Region: ${identityStoreRegion}`,
                    vscode.TreeItemCollapsibleState.None,
                    'identity-store-region',
                    { command: 'metricsExporter.setIdentityStoreRegion', title: 'Set Identity Store Region', arguments: [] }
                )
            ]);
        } else if (element.id === 'step2-identity') {
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const username = config.get<string>('aws.username', '');
            const userId = config.get<string>('aws.userId', '');
            const displayName = config.get<string>('aws.displayName', '');
            
            return Promise.resolve([
                new ConfigItem(
                    `Username: ${username || 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'username',
                    { command: 'metricsExporter.setUsername', title: 'Set Username', arguments: [] }
                ),
                new ConfigItem(
                    `🔄 Resolve User ID & Display Name`,
                    vscode.TreeItemCollapsibleState.None,
                    'resolve-user',
                    { command: 'metricsExporter.resolveUserId', title: 'Resolve User ID', arguments: [] }
                ),
                new ConfigItem(
                    `User ID: ${userId || 'Not resolved'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'user-id'
                ),
                new ConfigItem(
                    `Display Name: ${displayName || 'Not resolved'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'display-name'
                )
            ]);
        } else if (element.id === 'step3-s3') {
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const s3Prefix = config.get<string>('aws.s3Prefix', '');
            const s3Region = config.get<string>('aws.s3Region', 'us-east-1');
            
            return Promise.resolve([
                new ConfigItem(
                    `S3 Prefix: ${s3Prefix || 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    's3-prefix',
                    { command: 'metricsExporter.setS3Prefix', title: 'Set S3 Prefix', arguments: [] }
                ),
                new ConfigItem(
                    `S3 Region: ${s3Region}`,
                    vscode.TreeItemCollapsibleState.None,
                    's3-region',
                    { command: 'metricsExporter.setS3Region', title: 'Set S3 Region', arguments: [] }
                ),
                new ConfigItem(
                    `🔍 Check S3 Write Permission`,
                    vscode.TreeItemCollapsibleState.None,
                    'check-s3-permission',
                    { command: 'metricsExporter.checkS3Permission', title: 'Check S3 Permission', arguments: [] }
                )
            ]);
        } else if (element.id === 'step4-logs') {
            return Promise.resolve([
                new ConfigItem(
                    `📄 Open Log File`,
                    vscode.TreeItemCollapsibleState.None,
                    'open-log-file',
                    { command: 'metricsExporter.openLog', title: 'Open Log File', arguments: [] }
                ),
                new ConfigItem(
                    `📂 Open Log Folder`,
                    vscode.TreeItemCollapsibleState.None,
                    'open-log-folder',
                    { command: 'metricsExporter.openLogFolder', title: 'Open Log Folder', arguments: [] }
                ),
                new ConfigItem(
                    `⚙️ Open Settings`,
                    vscode.TreeItemCollapsibleState.None,
                    'open-settings',
                    { command: 'metricsExporter.openSettings', title: 'Open Settings', arguments: [] }
                )
            ]);
        }
        return Promise.resolve([]);
    }
}

export class ConfigItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly id: string,
        public readonly command?: vscode.Command
    ) {
        super(label, collapsibleState);
        this.id = id;
        this.tooltip = this.label;
        this.contextValue = id;
        
        if (command) {
            this.command = command;
        }
    }
}