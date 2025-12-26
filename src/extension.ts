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

    context.subscriptions.push(exportCommand, refreshCommand);
}

export function deactivate() {
    console.log('Kiro Metrics Exporter is now deactivated!');
}