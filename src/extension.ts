import * as vscode from 'vscode';
import { MetricsExporterProvider } from './metricsExporterProvider';
import { MetricsService } from './metricsService';

export function activate(context: vscode.ExtensionContext) {
    console.log('Kiro Metrics Exporter is now active!');

    // Create the metrics service
    const metricsService = new MetricsService();
    
    // Create and register the tree data provider
    const provider = new MetricsExporterProvider(context, metricsService);
    vscode.window.registerTreeDataProvider('metricsExporter', provider);

    // Register the export command
    const exportCommand = vscode.commands.registerCommand('metricsExporter.exportMetrics', () => {
        metricsService.exportMetrics();
    });

    // Register the refresh command
    const refreshCommand = vscode.commands.registerCommand('metricsExporter.refresh', () => {
        provider.refresh();
    });

    // Auto-resolve User ID when username changes
    let resolveTimeout: NodeJS.Timeout | undefined;
    let lastUsername = vscode.workspace.getConfiguration('metricsExporter').get<string>('aws.username', '');
    
    const configChangeListener = vscode.workspace.onDidChangeConfiguration(async (e) => {
        if (e.affectsConfiguration('metricsExporter.aws.username')) {
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const newUsername = config.get<string>('aws.username', '');
            
            // Only trigger if username actually changed and is not empty
            if (newUsername && newUsername !== lastUsername) {
                lastUsername = newUsername;
                
                // Check if required configurations are set
                const accessKey = config.get<string>('aws.accessKey', '');
                const secretKey = config.get<string>('aws.secretKey', '');
                const identityStoreId = config.get<string>('aws.identityStoreId', '');
                
                if (accessKey && secretKey && identityStoreId) {
                    // Debounce: wait 500ms before resolving
                    if (resolveTimeout) {
                        clearTimeout(resolveTimeout);
                    }
                    resolveTimeout = setTimeout(() => {
                        vscode.commands.executeCommand('metricsExporter.resolveUserId');
                    }, 500);
                }
            }
        }
    });

    context.subscriptions.push(exportCommand, refreshCommand, configChangeListener);
}

export function deactivate() {
    console.log('Kiro Metrics Exporter is now deactivated!');
}