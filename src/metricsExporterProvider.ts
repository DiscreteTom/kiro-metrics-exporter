import * as vscode from 'vscode';
import { MetricsService } from './metricsService';

export class MetricsExporterProvider implements vscode.TreeDataProvider<ConfigItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<ConfigItem | undefined | null | void> = new vscode.EventEmitter<ConfigItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<ConfigItem | undefined | null | void> = this._onDidChangeTreeData.event;

    constructor(
        private context: vscode.ExtensionContext,
        private metricsService: MetricsService
    ) {}

    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: ConfigItem): vscode.TreeItem {
        return element;
    }

    getChildren(element?: ConfigItem): Thenable<ConfigItem[]> {
        if (!element) {
            // Root level items
            return Promise.resolve([
                new ConfigItem(
                    'AWS Configuration',
                    vscode.TreeItemCollapsibleState.Expanded,
                    'aws-config'
                )
            ]);
        } else if (element.id === 'aws-config') {
            // AWS config children
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const accessKey = config.get<string>('aws.accessKey', '');
            const secretKey = config.get<string>('aws.secretKey', '');
            const s3Prefix = config.get<string>('aws.s3Prefix', '');
            const s3Region = config.get<string>('aws.s3Region', 'us-east-1');
            const identityStoreRegion = config.get<string>('aws.identityStoreRegion', 'us-east-1');
            const userId = config.get<string>('aws.userId', '');
            const identityStoreId = config.get<string>('aws.identityStoreId', '');
            
            return Promise.resolve([
                new ConfigItem(
                    `Access Key: ${accessKey ? '***' + accessKey.slice(-4) : 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'access-key',
                    {
                        command: 'metricsExporter.setAccessKey',
                        title: 'Set Access Key',
                        arguments: []
                    }
                ),
                new ConfigItem(
                    `Secret Key: ${secretKey ? '***' + secretKey.slice(-4) : 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'secret-key',
                    {
                        command: 'metricsExporter.setSecretKey',
                        title: 'Set Secret Key',
                        arguments: []
                    }
                ),
                new ConfigItem(
                    `S3 Prefix: ${s3Prefix || 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    's3-prefix',
                    {
                        command: 'metricsExporter.setS3Prefix',
                        title: 'Set S3 Prefix',
                        arguments: []
                    }
                ),
                new ConfigItem(
                    `S3 Region: ${s3Region}`,
                    vscode.TreeItemCollapsibleState.None,
                    's3-region',
                    {
                        command: 'metricsExporter.setS3Region',
                        title: 'Set S3 Region',
                        arguments: []
                    }
                ),
                new ConfigItem(
                    `Identity Store Region: ${identityStoreRegion}`,
                    vscode.TreeItemCollapsibleState.None,
                    'identity-store-region',
                    {
                        command: 'metricsExporter.setIdentityStoreRegion',
                        title: 'Set Identity Store Region',
                        arguments: []
                    }
                ),
                new ConfigItem(
                    `User ID: ${userId || 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'user-id',
                    {
                        command: 'metricsExporter.setUserId',
                        title: 'Set User ID',
                        arguments: []
                    }
                ),
                new ConfigItem(
                    `Identity Store ID: ${identityStoreId || 'Not set'}`,
                    vscode.TreeItemCollapsibleState.None,
                    'identity-store-id',
                    {
                        command: 'metricsExporter.setIdentityStoreId',
                        title: 'Set Identity Store ID',
                        arguments: []
                    }
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