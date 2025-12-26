import * as vscode from 'vscode';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { IdentitystoreClient, GetUserIdCommand } from '@aws-sdk/client-identitystore';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanKiroAgentDirectory, generateReport, exportToJson } from './extractor';
import { MetricsExport } from './types';

export class MetricsService {
    private s3Client: S3Client | null = null;
    private identityStoreClient: IdentitystoreClient | null = null;

    constructor() {
        this.registerCommands();
    }

    private registerCommands() {
        // Register commands for setting AWS credentials
        vscode.commands.registerCommand('metricsExporter.setAccessKey', async () => {
            const accessKey = await vscode.window.showInputBox({
                prompt: 'Enter AWS Access Key',
                password: true,
                placeHolder: 'AKIA...'
            });
            
            if (accessKey) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.accessKey', accessKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('AWS Access Key saved');
                this.refreshTreeView();
            }
        });

        vscode.commands.registerCommand('metricsExporter.setSecretKey', async () => {
            const secretKey = await vscode.window.showInputBox({
                prompt: 'Enter AWS Secret Key',
                password: true,
                placeHolder: 'Your secret key...'
            });
            
            if (secretKey) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.secretKey', secretKey, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('AWS Secret Key saved');
                this.refreshTreeView();
            }
        });

        // Register commands for setting S3 prefix
        vscode.commands.registerCommand('metricsExporter.setS3Prefix', async () => {
            const s3Prefix = await vscode.window.showInputBox({
                prompt: 'Enter S3 prefix path',
                placeHolder: 's3://bucketName/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter an S3 prefix path';
                    }
                    if (!value.startsWith('s3://')) {
                        return 'S3 prefix should start with s3://';
                    }
                    return null;
                }
            });
            
            if (s3Prefix) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.s3Prefix', s3Prefix, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('S3 prefix saved');
                this.refreshTreeView();
            }
        });

        vscode.commands.registerCommand('metricsExporter.setUserId', async () => {
            const username = await vscode.window.showInputBox({
                prompt: 'Enter Username',
                placeHolder: 'e.g., john.doe or john.doe@company.com',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter a username';
                    }
                    return null;
                }
            });
            
            if (username) {
                try {
                    const userId = await this.getUserIdByUsername(username.trim());
                    await vscode.workspace.getConfiguration().update('metricsExporter.aws.userId', userId, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage(`User ID resolved and saved: ${userId}`);
                    this.refreshTreeView();
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to resolve user ID: ${error}`);
                }
            }
        });

        vscode.commands.registerCommand('metricsExporter.setIdentityStoreId', async () => {
            const identityStoreId = await vscode.window.showInputBox({
                prompt: 'Enter Identity Store ID',
                placeHolder: 'e.g., d-1234567890 or 12345678-1234-1234-1234-123456789012',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter an Identity Store ID';
                    }
                    return null;
                }
            });
            
            if (identityStoreId) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.identityStoreId', identityStoreId, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Identity Store ID saved');
                this.refreshTreeView();
            }
        });

        // Register commands for time-filtered metrics export
        vscode.commands.registerCommand('metricsExporter.uploadLastMonth', async () => {
            await this.exportMetricsWithTimeFilter('lastMonth');
        });

        vscode.commands.registerCommand('metricsExporter.uploadLastWeek', async () => {
            await this.exportMetricsWithTimeFilter('lastWeek');
        });
    }

    private refreshTreeView() {
        vscode.commands.executeCommand('metricsExporter.refresh');
    }

    private initializeS3(): boolean {
        const config = vscode.workspace.getConfiguration('metricsExporter');
        const accessKey = config.get<string>('aws.accessKey');
        const secretKey = config.get<string>('aws.secretKey');
        const region = config.get<string>('aws.region', 'us-east-1');
        const s3Prefix = config.get<string>('aws.s3Prefix');
        const userId = config.get<string>('aws.userId');
        const identityStoreId = config.get<string>('aws.identityStoreId');

        if (!accessKey || !secretKey) {
            vscode.window.showErrorMessage('AWS credentials not configured. Please set Access Key and Secret Key.');
            return false;
        }

        if (!s3Prefix) {
            vscode.window.showErrorMessage('S3 prefix not configured. Please set S3 prefix path.');
            return false;
        }

        if (!userId) {
            vscode.window.showErrorMessage('User ID not configured. Please set User ID by username.');
            return false;
        }

        if (!identityStoreId) {
            vscode.window.showErrorMessage('Identity Store ID not configured. Please set Identity Store ID.');
            return false;
        }

        const credentials = {
            accessKeyId: accessKey,
            secretAccessKey: secretKey
        };

        this.s3Client = new S3Client({
            region: region,
            credentials: credentials
        });

        this.identityStoreClient = new IdentitystoreClient({
            region: region,
            credentials: credentials
        });

        return true;
    }

    /**
     * Get User ID by username using AWS Identity Store
     */
    private async getUserIdByUsername(username: string): Promise<string> {
        const config = vscode.workspace.getConfiguration('metricsExporter');
        const accessKey = config.get<string>('aws.accessKey');
        const secretKey = config.get<string>('aws.secretKey');
        const region = config.get<string>('aws.region', 'us-east-1');
        const identityStoreId = config.get<string>('aws.identityStoreId');

        if (!accessKey || !secretKey) {
            throw new Error('AWS credentials not configured');
        }

        if (!identityStoreId) {
            throw new Error('Identity Store ID not configured');
        }

        // Initialize Identity Store client if not already done
        if (!this.identityStoreClient) {
            this.identityStoreClient = new IdentitystoreClient({
                region: region,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                }
            });
        }

        try {
            const command = new GetUserIdCommand({
                IdentityStoreId: identityStoreId,
                AlternateIdentifier: {
                    UniqueAttribute: {
                        AttributePath: 'userName',
                        AttributeValue: username
                    }
                }
            });

            const response = await this.identityStoreClient.send(command);
            
            if (!response.UserId) {
                throw new Error('User ID not found in response');
            }

            return response.UserId;
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                throw new Error(`User '${username}' not found in Identity Store`);
            }
            throw new Error(`Failed to get user ID: ${error.message || error}`);
        }
    }

    /**
     * Get date range for filtering
     * @param filterType 'lastMonth' for T-30 to T-1, 'lastWeek' for T-7 to T-1
     */
    private getDateRange(filterType: 'lastMonth' | 'lastWeek'): { startDate: Date; endDate: Date } {
        const today = new Date();
        const endDate = new Date(today);
        endDate.setDate(today.getDate() - 1); // T-1 (yesterday)
        
        const startDate = new Date(today);
        if (filterType === 'lastMonth') {
            startDate.setDate(today.getDate() - 30); // T-30
        } else {
            startDate.setDate(today.getDate() - 7); // T-7
        }
        
        return { startDate, endDate };
    }

    /**
     * Filter daily stats by date range
     */
    private filterDailyStatsByDateRange(dailyStats: Record<string, any>, startDate: Date, endDate: Date): Record<string, any> {
        const filtered: Record<string, any> = {};
        
        for (const [dateStr, stats] of Object.entries(dailyStats)) {
            const date = new Date(dateStr);
            if (date >= startDate && date <= endDate) {
                filtered[dateStr] = stats;
            }
        }
        
        return filtered;
    }

    /**
     * Export metrics with time filter
     */
    async exportMetricsWithTimeFilter(filterType: 'lastMonth' | 'lastWeek') {
        const filterLabel = filterType === 'lastMonth' ? 'last month (T-30 to T-1)' : 'last week (T-7 to T-1)';
        vscode.window.showInformationMessage(`Starting ${filterLabel} metrics export...`);

        if (!this.initializeS3()) {
            return;
        }

        try {
            // Get the platform-specific kiro.kiroagent directory path
            const kiroAgentPath = this.getKiroAgentPath();
            
            // Check if kiro.kiroagent directory exists
            if (!fs.existsSync(kiroAgentPath)) {
                vscode.window.showErrorMessage(`kiro.kiroagent directory not found at: ${kiroAgentPath}`);
                return;
            }

            vscode.window.showInformationMessage(`Scanning directory: ${kiroAgentPath}`);

            // Use the same scanning logic as the standalone version
            const results = scanKiroAgentDirectory(kiroAgentPath);

            if (results.length === 0) {
                vscode.window.showWarningMessage('No valid code generation records found');
                return;
            }

            // Generate metrics export data
            const metricsData = exportToJson(results);
            
            // Apply time filter
            const { startDate, endDate } = this.getDateRange(filterType);
            const filteredDailyStats = this.filterDailyStatsByDateRange(metricsData.dailyStats, startDate, endDate);
            
            // Check if we have data in the filtered range
            if (Object.keys(filteredDailyStats).length === 0) {
                vscode.window.showWarningMessage(`No data found for ${filterLabel}`);
                return;
            }

            // Create filtered metrics data
            const filteredMetricsData = {
                ...metricsData,
                dailyStats: filteredDailyStats
            };

            vscode.window.showInformationMessage(`Found ${Object.keys(filteredDailyStats).length} days of data for ${filterLabel}`);
            
            // Get configuration
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const s3Prefix = config.get<string>('aws.s3Prefix')!;
            const userId = config.get<string>('aws.userId')!;
            
            // Upload separate CSV file for each day
            let uploadCount = 0;
            for (const [date, dailyStats] of Object.entries(filteredDailyStats)) {
                try {
                    // Convert single day data to CSV
                    const csvData = this.convertDayMetricsToCSV(date, dailyStats, userId);
                    
                    // Upload to S3 with proper path structure
                    await this.uploadDayCSVToS3(csvData, date, userId, s3Prefix, filterType);
                    uploadCount++;
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to upload data for ${date}: ${error}`);
                }
            }
            
            // Also show a summary report in output channel
            const report = generateReport(results);
            this.showReportInOutput(report);
            
            vscode.window.showInformationMessage(`${filterLabel} metrics exported successfully! Uploaded ${uploadCount} files.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error}`);
        }
    }

    /**
     * Convert metrics data to CSV format for a specific date
     * CSV Schema: UserId,Date,Chat_AICodeLines,Chat_MessagesInteracted,Chat_MessagesSent,... (other columns set to 0)
     */
    private convertDayMetricsToCSV(date: string, dailyStats: any, userId: string): string {
        const csvHeaders = [
            'UserId', 'Date', 'Chat_AICodeLines', 'Chat_MessagesInteracted', 'Chat_MessagesSent',
            'CodeFix_AcceptanceEventCount', 'CodeFix_AcceptedLines', 'CodeFix_GeneratedLines', 'CodeFix_GenerationEventCount',
            'CodeReview_FailedEventCount', 'CodeReview_FindingsCount', 'CodeReview_SucceededEventCount',
            'Dev_AcceptanceEventCount', 'Dev_AcceptedLines', 'Dev_GeneratedLines', 'Dev_GenerationEventCount',
            'DocGeneration_AcceptedFileUpdates', 'DocGeneration_AcceptedFilesCreations', 'DocGeneration_AcceptedLineAdditions', 'DocGeneration_AcceptedLineUpdates', 'DocGeneration_EventCount',
            'DocGeneration_RejectedFileCreations', 'DocGeneration_RejectedFileUpdates', 'DocGeneration_RejectedLineAdditions', 'DocGeneration_RejectedLineUpdates',
            'InlineChat_AcceptanceEventCount', 'InlineChat_AcceptedLineAdditions', 'InlineChat_AcceptedLineDeletions', 'InlineChat_DismissalEventCount',
            'InlineChat_DismissedLineAdditions', 'InlineChat_DismissedLineDeletions', 'InlineChat_RejectedLineAdditions', 'InlineChat_RejectedLineDeletions', 'InlineChat_RejectionEventCount', 'InlineChat_TotalEventCount',
            'Inline_AICodeLines', 'Inline_AcceptanceCount', 'Inline_SuggestionsCount',
            'TestGeneration_AcceptedLines', 'TestGeneration_AcceptedTests', 'TestGeneration_EventCount', 'TestGeneration_GeneratedLines', 'TestGeneration_GeneratedTests',
            'Transformation_EventCount', 'Transformation_LinesGenerated', 'Transformation_LinesIngested'
        ];

        const csvRows: string[] = [];
        csvRows.push(csvHeaders.join(','));

        // Format date as MM-DD-YYYY to match the example format
        const formattedDate = this.formatDateForCSV(date);
        
        // Calculate Chat_AICodeLines using net lines (same calculation as in extractor)
        const chatAICodeLines = dailyStats.fsWriteLines + dailyStats.strReplaceAdded - dailyStats.strReplaceDeleted;
        
        // Calculate Chat_MessagesSent (using execution count as proxy for messages sent)
        const chatMessagesSent = dailyStats.executionCount;

        // Create row with our data and zeros for other columns
        const row = [
            `"${userId}"`,
            formattedDate,
            chatAICodeLines.toString(),
            '0', // Chat_MessagesInteracted - set to 0 for now
            chatMessagesSent.toString(),
            // All other columns set to 0
            ...new Array(csvHeaders.length - 5).fill('0')
        ];

        csvRows.push(row.join(','));
        return csvRows.join('\n');
    }

    /**
     * Generate S3 path following the pattern:
     * s3://bucketName/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/year/month/day/00/kiro-ide-{userid}_timestamp.csv
     */
    private generateS3Path(date: string, userId: string, s3Prefix: string): { bucket: string; key: string } {
        // Parse the s3Prefix to extract bucket and base path
        // Expected format: s3://bucketName/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/
        const s3Match = s3Prefix.match(/^s3:\/\/([^\/]+)\/(.+)$/);
        if (!s3Match) {
            throw new Error('Invalid S3 prefix format. Expected: s3://bucketName/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/');
        }

        const bucket = s3Match[1];
        const basePath = s3Match[2].replace(/\/$/, ''); // Remove trailing slash if present

        // Parse date (YYYY-MM-DD format)
        const [year, month, day] = date.split('-');
        
        // Generate timestamp
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        
        // Build the key following the pattern
        const key = `${basePath}/${year}/${month}/${day}/00/kiro-ide-${userId}_${timestamp}.csv`;

        return { bucket, key };
    }
    /**
     * Format date from YYYY-MM-DD to MM-DD-YYYY format
     */
    private formatDateForCSV(dateStr: string): string {
        const [year, month, day] = dateStr.split('-');
        return `${month}-${day}-${year}`;
    }

    /**
     * Get the platform-specific kiro.kiroagent directory path
     */
    private getKiroAgentPath(): string {
        const platform = os.platform();
        
        switch (platform) {
            case 'win32':
                // Windows: %APPDATA%\Kiro\User\globalStorage\kiro.kiroagent
                const appData = process.env.APPDATA;
                if (!appData) {
                    throw new Error('APPDATA environment variable not found');
                }
                return path.join(appData, 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
                
            case 'darwin':
                // macOS: ~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent
                return path.join(os.homedir(), 'Library', 'Application Support', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
                
            case 'linux':
                // Linux: ~/.config/Kiro/User/globalStorage/kiro.kiroagent
                return path.join(os.homedir(), '.config', 'Kiro', 'User', 'globalStorage', 'kiro.kiroagent');
                
            default:
                throw new Error(`Unsupported platform: ${platform}`);
        }
    }

    async exportMetrics() {
        vscode.window.showInformationMessage('Starting metrics export...');

        if (!this.initializeS3()) {
            return;
        }

        try {
            // Get the platform-specific kiro.kiroagent directory path
            const kiroAgentPath = this.getKiroAgentPath();
            
            // Check if kiro.kiroagent directory exists
            if (!fs.existsSync(kiroAgentPath)) {
                vscode.window.showErrorMessage(`kiro.kiroagent directory not found at: ${kiroAgentPath}`);
                return;
            }

            vscode.window.showInformationMessage(`Scanning directory: ${kiroAgentPath}`);

            // Use the same scanning logic as the standalone version
            const results = scanKiroAgentDirectory(kiroAgentPath);

            if (results.length === 0) {
                vscode.window.showWarningMessage('No valid code generation records found');
                return;
            }

            vscode.window.showInformationMessage(`Found ${results.length} valid code generation records`);

            // Generate metrics export data
            const metricsData = exportToJson(results);
            
            // Get configuration
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const s3Prefix = config.get<string>('aws.s3Prefix')!;
            const userId = config.get<string>('aws.userId')!;
            
            // Upload separate CSV file for each day
            let uploadCount = 0;
            for (const [date, dailyStats] of Object.entries(metricsData.dailyStats)) {
                try {
                    // Convert single day data to CSV
                    const csvData = this.convertDayMetricsToCSV(date, dailyStats, userId);
                    
                    // Upload to S3 with proper path structure
                    await this.uploadDayCSVToS3(csvData, date, userId, s3Prefix);
                    uploadCount++;
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to upload data for ${date}: ${error}`);
                }
            }
            
            // Also show a summary report in output channel
            const report = generateReport(results);
            this.showReportInOutput(report);
            
            vscode.window.showInformationMessage(`Metrics exported successfully! Uploaded ${uploadCount} files.`);
        } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error}`);
        }
    }

    private showReportInOutput(report: string): void {
        const outputChannel = vscode.window.createOutputChannel('Kiro Metrics Report');
        outputChannel.clear();
        outputChannel.appendLine(report);
        outputChannel.show();
    }

    private async uploadDayCSVToS3(csvData: string, date: string, userId: string, s3Prefix: string, filterType?: 'lastMonth' | 'lastWeek'): Promise<void> {
        if (!this.s3Client) {
            throw new Error('S3 client not initialized');
        }

        try {
            // Generate S3 path following the specified pattern
            const { bucket, key } = this.generateS3Path(date, userId, s3Prefix);
            
            const command = new PutObjectCommand({
                Bucket: bucket,
                Key: key,
                Body: csvData,
                ContentType: 'text/csv',
                Metadata: {
                    'export-time': new Date().toISOString(),
                    'date': date,
                    'user-id': userId,
                    'filter-type': filterType || 'all'
                }
            });

            vscode.window.showInformationMessage(`Uploading CSV to S3: s3://${bucket}/${key}`);
            
            await this.s3Client.send(command);
            
            const filterLabel = filterType ? ` (${filterType === 'lastMonth' ? 'last month' : 'last week'})` : '';
            vscode.window.showInformationMessage(
                `✅ Successfully uploaded CSV for ${date}${filterLabel} to S3: s3://${bucket}/${key}`
            );
            
            console.log(`CSV metrics uploaded successfully:
                S3: s3://${bucket}/${key}
                Date: ${date}
                User ID: ${userId}
                Filter: ${filterType || 'all'}
                Generated at: ${new Date().toISOString()}`);
                
        } catch (error: any) {
            throw new Error(`S3 CSV upload failed for ${date}: ${error.message || error}`);
        }
    }

}