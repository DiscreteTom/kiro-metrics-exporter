import * as vscode from 'vscode';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanKiroAgentDirectory, generateReport, exportToJson } from './extractor';
import { MetricsExport } from './types';

export class MetricsService {
    private s3Client: S3Client | null = null;

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

        if (!accessKey || !secretKey) {
            vscode.window.showErrorMessage('AWS credentials not configured. Please set Access Key and Secret Key.');
            return false;
        }

        this.s3Client = new S3Client({
            region: region,
            credentials: {
                accessKeyId: accessKey,
                secretAccessKey: secretKey
            }
        });

        return true;
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
            
            // Convert to CSV format
            const csvData = this.convertMetricsToCSV(filteredMetricsData);
            
            // Upload CSV to S3 with time filter label
            await this.uploadCSVToS3(csvData, metricsData.summary, filterType);
            
            // Also show a summary report in output channel
            const report = generateReport(results);
            this.showReportInOutput(report);
            
            vscode.window.showInformationMessage(`${filterLabel} metrics exported successfully!`);
        } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error}`);
        }
    }

    /**
     * Convert metrics data to CSV format
     * CSV Schema: UserId,Date,Chat_AICodeLines,Chat_MessagesInteracted,Chat_MessagesSent,... (other columns set to 0)
     * We focus on: UserId, Date, Chat_AICodeLines, Chat_MessagesSent
     */
    private convertMetricsToCSV(metricsData: MetricsExport): string {
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

        // Generate a placeholder user ID (will be implemented later)
        const userId = 'placeholder-user-id';

        // Process daily stats to create CSV rows
        for (const [date, dailyStats] of Object.entries(metricsData.dailyStats)) {
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
        }

        return csvRows.join('\n');
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
            
            // Convert to CSV format
            const csvData = this.convertMetricsToCSV(metricsData);
            
            // Upload CSV to S3
            await this.uploadCSVToS3(csvData, metricsData.summary);
            
            // Also show a summary report in output channel
            const report = generateReport(results);
            this.showReportInOutput(report);
            
            vscode.window.showInformationMessage('Metrics exported successfully!');
        } catch (error) {
            vscode.window.showErrorMessage(`Export failed: ${error}`);
        }
    }

    async testFileUpload() {
        vscode.window.showInformationMessage('Starting test file upload...');

        if (!this.initializeS3()) {
            return;
        }

        try {
            // Get local file path from user
            const localPath = await vscode.window.showInputBox({
                prompt: 'Enter local file path (absolute or relative to workspace)',
                placeHolder: 'e.g., ./README.md or C:\\path\\to\\file.txt',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter a file path';
                    }
                    return null;
                }
            });

            if (!localPath) {
                return;
            }

            // Get S3 path from user
            const s3Path = await vscode.window.showInputBox({
                prompt: 'Enter S3 path (bucket/key format)',
                placeHolder: 'e.g., my-bucket/folder/file.txt',
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter an S3 path';
                    }
                    if (!value.includes('/')) {
                        return 'S3 path should include bucket and key (bucket/key)';
                    }
                    return null;
                }
            });

            if (!s3Path) {
                return;
            }

            // Upload the file
            await this.uploadFileToS3(localPath.trim(), s3Path.trim());
            
            vscode.window.showInformationMessage('Test file upload completed successfully!');
        } catch (error) {
            vscode.window.showErrorMessage(`Test upload failed: ${error}`);
        }
    }

    private showReportInOutput(report: string): void {
        const outputChannel = vscode.window.createOutputChannel('Kiro Metrics Report');
        outputChannel.clear();
        outputChannel.appendLine(report);
        outputChannel.show();
    }

    private async uploadCSVToS3(csvData: string, summary: any, filterType?: 'lastMonth' | 'lastWeek'): Promise<void> {
        if (!this.s3Client) {
            throw new Error('S3 client not initialized');
        }

        // Generate a timestamped filename with filter type
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const bucketName = 'kiro-metrics-bucket'; // This should be configurable
        
        let key: string;
        if (filterType) {
            const filterLabel = filterType === 'lastMonth' ? 'last-month' : 'last-week';
            key = `metrics/${timestamp}-kiro-metrics-${filterLabel}.csv`;
        } else {
            key = `metrics/${timestamp}-kiro-metrics.csv`;
        }
        
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: csvData,
            ContentType: 'text/csv',
            Metadata: {
                'export-time': new Date().toISOString(),
                'total-executions': summary.totalExecutions.toString(),
                'net-lines': summary.netLines.toString(),
                'filter-type': filterType || 'all'
            }
        });

        try {
            vscode.window.showInformationMessage(`Uploading CSV to S3: s3://${bucketName}/${key}`);
            
            await this.s3Client.send(command);
            
            const filterLabel = filterType ? ` (${filterType === 'lastMonth' ? 'last month' : 'last week'})` : '';
            vscode.window.showInformationMessage(
                `✅ Successfully uploaded CSV metrics${filterLabel} to S3: s3://${bucketName}/${key}\n` +
                `Total executions: ${summary.totalExecutions}\n` +
                `Net lines generated: ${summary.netLines}`
            );
            
            console.log(`CSV metrics uploaded successfully:
                S3: s3://${bucketName}/${key}
                Filter: ${filterType || 'all'}
                Total executions: ${summary.totalExecutions}
                Net lines: ${summary.netLines}
                Generated at: ${new Date().toISOString()}`);
                
        } catch (error: any) {
            throw new Error(`S3 CSV upload failed: ${error.message || error}`);
        }
    }

    private async uploadFileToS3(localPath: string, s3Path: string): Promise<void> {
        if (!this.s3Client) {
            throw new Error('S3 client not initialized');
        }

        // Parse S3 path (bucket/key)
        const pathParts = s3Path.split('/');
        const bucketName = pathParts[0];
        const key = pathParts.slice(1).join('/');

        if (!bucketName || !key) {
            throw new Error('Invalid S3 path format. Use: bucket/key');
        }

        // Resolve local path
        let resolvedPath = localPath;
        if (!path.isAbsolute(localPath)) {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (workspaceFolder) {
                resolvedPath = path.join(workspaceFolder.uri.fsPath, localPath);
            }
        }

        // Check if file exists
        if (!fs.existsSync(resolvedPath)) {
            throw new Error(`File not found: ${resolvedPath}`);
        }

        // Read file content
        const fileContent = fs.readFileSync(resolvedPath);
        const fileStats = fs.statSync(resolvedPath);

        vscode.window.showInformationMessage(`Reading file: ${resolvedPath} (${fileStats.size} bytes)`);

        // Determine content type based on file extension
        const ext = path.extname(resolvedPath).toLowerCase();
        const contentTypeMap: Record<string, string> = {
            '.txt': 'text/plain',
            '.json': 'application/json',
            '.xml': 'application/xml',
            '.html': 'text/html',
            '.css': 'text/css',
            '.js': 'application/javascript',
            '.ts': 'text/plain',
            '.md': 'text/markdown',
            '.csv': 'text/csv',
            '.log': 'text/plain'
        };
        const contentType = contentTypeMap[ext] || 'application/octet-stream';

        // Upload to S3
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: fileContent,
            ContentType: contentType,
            Metadata: {
                'original-path': resolvedPath,
                'upload-time': new Date().toISOString(),
                'file-size': fileStats.size.toString()
            }
        });

        try {
            vscode.window.showInformationMessage(`Uploading to S3: s3://${bucketName}/${key}`);
            
            await this.s3Client.send(command);
            
            vscode.window.showInformationMessage(
                `✅ Successfully uploaded to S3: s3://${bucketName}/${key}\n` +
                `File size: ${fileStats.size} bytes\n` +
                `Content type: ${contentType}`
            );
            
            console.log(`File uploaded successfully:
                Local: ${resolvedPath}
                S3: s3://${bucketName}/${key}
                Size: ${fileStats.size} bytes
                Content-Type: ${contentType}`);
                
        } catch (error: any) {
            throw new Error(`S3 upload failed: ${error.message || error}`);
        }
    }
}