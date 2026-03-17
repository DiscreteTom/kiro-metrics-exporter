import * as vscode from 'vscode';
import { MetricsExporterProvider } from './metricsExporterProvider';
import { MetricsService } from './metricsService';
import { logger } from './logger';

let autoUploadTimer: NodeJS.Timeout | undefined;

/**
 * Start or restart the auto-upload timer based on current configuration.
 * When enabled, it immediately performs one upload, then repeats at the configured interval.
 */
function startAutoUploadTimer(metricsService: MetricsService) {
    // Always clear existing timer first
    stopAutoUploadTimer();

    const config = vscode.workspace.getConfiguration('metricsExporter');
    const enabled = config.get<boolean>('autoUpload.enabled', false);
    const intervalHours = config.get<number>('autoUpload.intervalHours', 8);

    if (!enabled) {
        logger.info('Auto Upload', 'Auto upload is disabled');
        return;
    }

    const intervalMs = intervalHours * 60 * 60 * 1000;
    logger.info('Auto Upload', `Auto upload enabled - interval: ${intervalHours}h, uploading now and then every ${intervalHours}h`);

    // Immediate upload on startup (with a short delay to let the extension fully initialize)
    setTimeout(async () => {
        logger.info('Auto Upload', 'Performing initial auto upload (lastWeek)...');
        try {
            await metricsService.exportMetricsWithTimeFilter('lastWeek', true);
            logger.info('Auto Upload', 'Initial auto upload completed');
        } catch (error: any) {
            logger.error('Auto Upload', `Initial auto upload failed: ${error.message || error}`);
        }
    }, 5000); // 5 second delay for initialization

    // Set up recurring timer
    autoUploadTimer = setInterval(async () => {
        logger.info('Auto Upload', `Performing scheduled auto upload (lastWeek)...`);
        try {
            await metricsService.exportMetricsWithTimeFilter('lastWeek', true);
            logger.info('Auto Upload', 'Scheduled auto upload completed');
        } catch (error: any) {
            logger.error('Auto Upload', `Scheduled auto upload failed: ${error.message || error}`);
        }
    }, intervalMs);
}

function stopAutoUploadTimer() {
    if (autoUploadTimer) {
        clearInterval(autoUploadTimer);
        autoUploadTimer = undefined;
        logger.info('Auto Upload', 'Auto upload timer stopped');
    }
}

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

        // React to auto-upload config changes
        if (e.affectsConfiguration('metricsExporter.autoUpload.enabled') ||
            e.affectsConfiguration('metricsExporter.autoUpload.intervalHours')) {
            logger.info('Auto Upload', 'Configuration changed, restarting auto upload timer...');
            startAutoUploadTimer(metricsService);
        }
    });

    context.subscriptions.push(exportCommand, refreshCommand, configChangeListener);

    // Start auto-upload timer based on current configuration
    startAutoUploadTimer(metricsService);
}

export function deactivate() {
    stopAutoUploadTimer();
    console.log('Kiro Metrics Exporter is now deactivated!');
}