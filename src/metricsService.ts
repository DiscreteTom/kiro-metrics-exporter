import * as vscode from 'vscode';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { IdentitystoreClient, GetUserIdCommand, DescribeUserCommand } from '@aws-sdk/client-identitystore';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { scanKiroAgentDirectory, generateReport, exportToJson } from './extractor';
import { MetricsExport } from './types';
import { logger } from './logger';

interface UserInfo {
    userId: string;
    displayName: string;
}

export class MetricsService {
    private s3Client: S3Client | null = null;
    private identityStoreClient: IdentitystoreClient | null = null;
    private disposables: vscode.Disposable[] = [];

    constructor() {
        this.registerCommands();
    }

    dispose() {
        this.disposables.forEach(d => d.dispose());
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

        // Register commands for setting regions
        vscode.commands.registerCommand('metricsExporter.setS3Region', async () => {
            const s3Region = await vscode.window.showInputBox({
                prompt: 'Enter S3 Region',
                placeHolder: 'e.g., us-east-1, us-west-2, eu-west-1',
                value: vscode.workspace.getConfiguration('metricsExporter').get<string>('aws.s3Region', 'us-east-1'),
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter an AWS region';
                    }
                    return null;
                }
            });
            
            if (s3Region) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.s3Region', s3Region, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('S3 region saved');
                this.refreshTreeView();
            }
        });

        vscode.commands.registerCommand('metricsExporter.setIdentityStoreRegion', async () => {
            const identityStoreRegion = await vscode.window.showInputBox({
                prompt: 'Enter Identity Store Region',
                placeHolder: 'e.g., us-east-1, us-west-2, eu-west-1',
                value: vscode.workspace.getConfiguration('metricsExporter').get<string>('aws.identityStoreRegion', 'us-east-1'),
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter an AWS region';
                    }
                    return null;
                }
            });
            
            if (identityStoreRegion) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.identityStoreRegion', identityStoreRegion, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage('Identity Store region saved');
                this.refreshTreeView();
            }
        });

        // Set Username (just save the username, no resolution)
        vscode.commands.registerCommand('metricsExporter.setUsername', async () => {
            const currentUsername = vscode.workspace.getConfiguration('metricsExporter').get<string>('aws.username', '');
            const username = await vscode.window.showInputBox({
                prompt: 'Enter Username',
                placeHolder: 'e.g., john.doe or john.doe@company.com',
                value: currentUsername,
                validateInput: (value) => {
                    if (!value || value.trim() === '') {
                        return 'Please enter a username';
                    }
                    return null;
                }
            });
            
            if (username) {
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.username', username.trim(), vscode.ConfigurationTarget.Global);
                // Clear the resolved userId when username changes
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.userId', '', vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`Username saved: ${username.trim()}. Click "Resolve User ID" to get the User ID.`);
                this.refreshTreeView();
            }
        });

        // Resolve User ID & Display Name from saved username
        vscode.commands.registerCommand('metricsExporter.resolveUserId', async () => {
            const config = vscode.workspace.getConfiguration('metricsExporter');
            const username = config.get<string>('aws.username', '');
            const accessKey = config.get<string>('aws.accessKey');
            const secretKey = config.get<string>('aws.secretKey');
            const identityStoreId = config.get<string>('aws.identityStoreId');

            // Check prerequisites
            if (!accessKey || !secretKey) {
                vscode.window.showErrorMessage('❌ Please configure AWS Access Key and Secret Key first');
                return;
            }

            if (!identityStoreId) {
                vscode.window.showErrorMessage('❌ Please configure Identity Store ID first');
                return;
            }

            if (!username) {
                vscode.window.showErrorMessage('❌ Please set Username first');
                return;
            }

            try {
                vscode.window.showInformationMessage(`🔄 Resolving User ID & Display Name for: ${username}...`);
                const userInfo = await this.getUserInfoByUsername(username);
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.userId', userInfo.userId, vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.displayName', userInfo.displayName, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage(`✅ Resolved - User ID: ${userInfo.userId}, Display Name: ${userInfo.displayName}`);
                this.refreshTreeView();
            } catch (error: any) {
                // Clear User ID and Display Name on failure
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.userId', '', vscode.ConfigurationTarget.Global);
                await vscode.workspace.getConfiguration().update('metricsExporter.aws.displayName', '', vscode.ConfigurationTarget.Global);
                const errorMsg = error.message || String(error);
                vscode.window.showErrorMessage(`❌ Failed to resolve: ${errorMsg}`);
                this.refreshTreeView();
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

        // Check S3 write permission
        vscode.commands.registerCommand('metricsExporter.checkS3Permission', async () => {
            await this.checkS3WritePermission();
        });

        // Open log file
        vscode.commands.registerCommand('metricsExporter.openLog', async () => {
            const logFile = logger.getCurrentLogFile();
            if (fs.existsSync(logFile)) {
                const doc = await vscode.workspace.openTextDocument(logFile);
                await vscode.window.showTextDocument(doc);
            } else {
                vscode.window.showInformationMessage('No log file found for today. Logs will be created when you perform an upload operation.');
            }
        });

        // Open log folder
        vscode.commands.registerCommand('metricsExporter.openLogFolder', async () => {
            const logDir = logger.getLogDir();
            if (!fs.existsSync(logDir)) {
                fs.mkdirSync(logDir, { recursive: true });
            }
            vscode.env.openExternal(vscode.Uri.file(logDir));
        });

        // Open Settings
        vscode.commands.registerCommand('metricsExporter.openSettings', async () => {
            vscode.commands.executeCommand('workbench.action.openSettings', '@ext:undefined_publisher.kiro-metrics-exporter');
        });

        // Register commands for time-filtered metrics export
        vscode.commands.registerCommand('metricsExporter.uploadLastWeek', async () => {
            await this.exportMetricsWithTimeFilter('lastWeek');
        });

        vscode.commands.registerCommand('metricsExporter.uploadAllTillYesterday', async () => {
            // Show confirmation dialog before uploading all data
            const confirm = await vscode.window.showWarningMessage(
                'Are you sure you want to Upload All? This may take a long time to complete. For daily routine work, it is recommended to use "Upload Last 7 Days" instead.',
                { modal: true },
                'Yes, Upload All',
                'Cancel'
            );
            
            if (confirm === 'Yes, Upload All') {
                await this.exportMetricsWithTimeFilter('allTillYesterday');
            }
        });
    }

    private refreshTreeView() {
        vscode.commands.executeCommand('metricsExporter.refresh');
    }

    /**
     * Check S3 write permission by attempting to upload a test file
     */
    private async checkS3WritePermission(): Promise<void> {
        const config = vscode.workspace.getConfiguration('metricsExporter');
        const accessKey = config.get<string>('aws.accessKey');
        const secretKey = config.get<string>('aws.secretKey');
        const s3Region = config.get<string>('aws.s3Region', 'us-east-1');
        const s3Prefix = config.get<string>('aws.s3Prefix');

        // Check prerequisites
        if (!accessKey || !secretKey) {
            vscode.window.showErrorMessage('❌ Please configure AWS Access Key and Secret Key first (Step 1)');
            return;
        }

        if (!s3Prefix) {
            vscode.window.showErrorMessage('❌ Please configure S3 Prefix first');
            return;
        }

        // Parse S3 prefix
        const s3Match = s3Prefix.match(/^s3:\/\/([^\/]+)\/(.*)$/);
        if (!s3Match) {
            vscode.window.showErrorMessage('❌ Invalid S3 prefix format. Expected: s3://bucket-name/prefix/');
            return;
        }

        const bucket = s3Match[1];
        const basePath = s3Match[2].replace(/\/$/, '');

        try {
            vscode.window.showInformationMessage(`🔄 Checking S3 write permission for bucket: ${bucket}...`);

            // Initialize S3 client
            const s3Client = new S3Client({
                region: s3Region,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                }
            });

            // Try to upload a test file
            const testKey = `${basePath}/.permission-test-${Date.now()}.txt`;
            const testContent = `Permission test at ${new Date().toISOString()}`;

            const putCommand = new PutObjectCommand({
                Bucket: bucket,
                Key: testKey,
                Body: testContent,
                ContentType: 'text/plain'
            });

            await s3Client.send(putCommand);

            // If successful, try to delete the test file (optional cleanup)
            try {
                const { DeleteObjectCommand } = await import('@aws-sdk/client-s3');
                const deleteCommand = new DeleteObjectCommand({
                    Bucket: bucket,
                    Key: testKey
                });
                await s3Client.send(deleteCommand);
            } catch {
                // Ignore delete errors - write permission is confirmed
            }

            vscode.window.showInformationMessage(`✅ S3 write permission confirmed! Bucket: ${bucket}, Path: ${basePath}/`);
        } catch (error: any) {
            const errorMsg = error.message || String(error);
            if (errorMsg.includes('AccessDenied') || errorMsg.includes('403')) {
                vscode.window.showErrorMessage(`❌ No write permission to S3 bucket: ${bucket}. Please check IAM policy.`);
            } else if (errorMsg.includes('NoSuchBucket') || errorMsg.includes('404')) {
                vscode.window.showErrorMessage(`❌ S3 bucket not found: ${bucket}. Please check bucket name.`);
            } else if (errorMsg.includes('InvalidAccessKeyId')) {
                vscode.window.showErrorMessage(`❌ Invalid AWS Access Key. Please check your credentials.`);
            } else if (errorMsg.includes('SignatureDoesNotMatch')) {
                vscode.window.showErrorMessage(`❌ Invalid AWS Secret Key. Please check your credentials.`);
            } else {
                vscode.window.showErrorMessage(`❌ S3 permission check failed: ${errorMsg}`);
            }
        }
    }

    private initializeS3(): boolean {
        const config = vscode.workspace.getConfiguration('metricsExporter');
        const accessKey = config.get<string>('aws.accessKey');
        const secretKey = config.get<string>('aws.secretKey');
        const s3Region = config.get<string>('aws.s3Region', 'us-east-1');
        const identityStoreRegion = config.get<string>('aws.identityStoreRegion', 'us-east-1');
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
            region: s3Region,
            credentials: credentials
        });

        this.identityStoreClient = new IdentitystoreClient({
            region: identityStoreRegion,
            credentials: credentials
        });

        return true;
    }

    /**
     * Get User ID and Display Name by username using AWS Identity Store
     */
    private async getUserInfoByUsername(username: string): Promise<UserInfo> {
        const config = vscode.workspace.getConfiguration('metricsExporter');
        const accessKey = config.get<string>('aws.accessKey');
        const secretKey = config.get<string>('aws.secretKey');
        const identityStoreRegion = config.get<string>('aws.identityStoreRegion', 'us-east-1');
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
                region: identityStoreRegion,
                credentials: {
                    accessKeyId: accessKey,
                    secretAccessKey: secretKey
                }
            });
        }

        try {
            // Step 1: Get User ID by username
            const getUserIdCommand = new GetUserIdCommand({
                IdentityStoreId: identityStoreId,
                AlternateIdentifier: {
                    UniqueAttribute: {
                        AttributePath: 'userName',
                        AttributeValue: username
                    }
                }
            });

            const getUserIdResponse = await this.identityStoreClient.send(getUserIdCommand);
            
            if (!getUserIdResponse.UserId) {
                throw new Error('User ID not found in response');
            }

            const userId = getUserIdResponse.UserId;

            // Step 2: Get Display Name by User ID
            const describeUserCommand = new DescribeUserCommand({
                IdentityStoreId: identityStoreId,
                UserId: userId
            });

            const describeUserResponse = await this.identityStoreClient.send(describeUserCommand);
            const displayName = describeUserResponse.DisplayName || describeUserResponse.UserName || username;

            return { userId, displayName };
        } catch (error: any) {
            if (error.name === 'ResourceNotFoundException') {
                throw new Error(`User '${username}' not found in Identity Store`);
            }
            throw new Error(`Failed to get user info: ${error.message || error}`);
        }
    }

    /**
     * Get date range for filtering
     * @param filterType 'allTillYesterday' for all data up to T-1, 'lastWeek' for T-7 to T-1
     */
    private getDateRange(filterType: 'allTillYesterday' | 'lastWeek'): { startDate: Date; endDate: Date } {
        const today = new Date();
        
        // Create end date (yesterday) at end of day in local time (23:59:59.999)
        const endDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1, 23, 59, 59, 999);
        
        let startDate: Date;
        if (filterType === 'allTillYesterday') {
            // Set to a very early date to include all available data (start of day)
            startDate = new Date(2020, 0, 1, 0, 0, 0, 0); // January 1, 2020 00:00:00 in local time
        } else {
            // Last week: 7 days ago at start of day in local time (00:00:00)
            startDate = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 7, 0, 0, 0, 0);
        }
        
        return { startDate, endDate };
    }

    /**
     * Filter daily stats by date range
     */
    private filterDailyStatsByDateRange(dailyStats: Record<string, any>, startDate: Date, endDate: Date): Record<string, any> {
        const filtered: Record<string, any> = {};
        
        for (const [dateStr, stats] of Object.entries(dailyStats)) {
            // Parse date string (YYYY-MM-DD) as local date at end of day (23:59:59.999)
            // This ensures we include all data for that day
            const [year, month, day] = dateStr.split('-').map(Number);
            const date = new Date(year, month - 1, day, 23, 59, 59, 999); // month is 0-indexed
            
            if (date >= startDate && date <= endDate) {
                filtered[dateStr] = stats;
            }
        }
        
        return filtered;
    }

    /**
     * Export metrics with time filter
     */
    async exportMetricsWithTimeFilter(filterType: 'lastWeek' | 'allTillYesterday') {
        const logContext = filterType === 'allTillYesterday' ? 'Upload All Till Yesterday' : 'Upload Last 7 Days';
        const filterLabel = filterType === 'allTillYesterday' ? 'all data till yesterday' : 'last week (T-7 to T-1)';
        const totalStartTime = Date.now();
        
        // Get user info for logging
        const config = vscode.workspace.getConfiguration('metricsExporter');
        const username = config.get<string>('aws.username', '');
        const userId = config.get<string>('aws.userId', '');
        const s3Prefix = config.get<string>('aws.s3Prefix', '');
        const s3Region = config.get<string>('aws.s3Region', 'us-east-1');
        
        logger.info(logContext, `========== Operation Started ==========`);
        logger.info(logContext, `User: ${username}, UserId: ${userId}`);
        logger.info(logContext, `S3 Prefix: ${s3Prefix}, Region: ${s3Region}`);
        logger.info(logContext, `Filter Type: ${filterType}`);
        vscode.window.showInformationMessage(`Starting ${filterLabel} metrics export...`);

        if (!this.initializeS3()) {
            logger.error(logContext, 'Failed - S3 initialization failed (missing credentials or configuration)');
            return;
        }

        try {
            // Get the platform-specific kiro.kiroagent directory path
            const kiroAgentPath = this.getKiroAgentPath();
            
            // Check if kiro.kiroagent directory exists
            if (!fs.existsSync(kiroAgentPath)) {
                logger.error(logContext, `Failed - kiro.kiroagent directory not found at: ${kiroAgentPath}`);
                vscode.window.showErrorMessage(`kiro.kiroagent directory not found at: ${kiroAgentPath}`);
                return;
            }

            // === Scanning Phase ===
            const scanStartTime = Date.now();
            logger.info(logContext, `[Scanning] Started - Directory: ${kiroAgentPath}`);
            vscode.window.showInformationMessage(`Scanning directory: ${kiroAgentPath}`);

            // Use the same scanning logic as the standalone version
            const results = scanKiroAgentDirectory(kiroAgentPath);
            const scanElapsed = ((Date.now() - scanStartTime) / 1000).toFixed(2);

            if (results.length === 0) {
                logger.warn(logContext, `[Scanning] Completed in ${scanElapsed}s - No valid code generation records found`);
                vscode.window.showWarningMessage('No valid code generation records found');
                return;
            }
            
            logger.info(logContext, `[Scanning] Completed in ${scanElapsed}s - Found ${results.length} execution records`);

            // Generate metrics export data
            const metricsData = exportToJson(results);
            
            // Apply time filter
            const { startDate, endDate } = this.getDateRange(filterType);
            logger.info(logContext, `[Filter] Date range: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
            
            const filteredDailyStats = this.filterDailyStatsByDateRange(metricsData.dailyStats, startDate, endDate);
            
            // Check if we have data in the filtered range
            if (Object.keys(filteredDailyStats).length === 0) {
                logger.warn(logContext, `[Filter] No data found for date range`);
                vscode.window.showWarningMessage(`No data found for ${filterLabel}`);
                return;
            }

            // Create filtered metrics data
            const filteredMetricsData = {
                ...metricsData,
                dailyStats: filteredDailyStats
            };

            const daysCount = Object.keys(filteredDailyStats).length;
            logger.info(logContext, `[Filter] Found ${daysCount} days of data to upload`);
            vscode.window.showInformationMessage(`Found ${daysCount} days of data for ${filterLabel}`);
            
            // === Upload Phase ===
            const uploadStartTime = Date.now();
            logger.info(logContext, `[Upload] Started - ${daysCount} files to upload`);
            
            // Upload separate CSV file for each day
            let uploadCount = 0;
            for (const [date, dailyStats] of Object.entries(filteredDailyStats)) {
                try {
                    // Convert single day data to CSV
                    const csvData = this.convertDayMetricsToCSV(date, dailyStats, userId);
                    
                    // Generate full S3 path for logging
                    const { bucket, key } = this.generateS3Path(date, userId, s3Prefix);
                    const fullS3Path = `s3://${bucket}/${key}`;
                    
                    // Upload to S3 with proper path structure
                    await this.uploadDayCSVToS3(csvData, date, userId, s3Prefix, filterType);
                    uploadCount++;
                    logger.info(logContext, `[Upload] ${uploadCount}/${daysCount} - ${date} -> ${fullS3Path}`);
                } catch (error: any) {
                    logger.error(logContext, `[Upload] Failed - ${date}: ${error.message || error}`);
                    vscode.window.showErrorMessage(`Failed to upload data for ${date}: ${error}`);
                }
            }
            
            const uploadElapsed = ((Date.now() - uploadStartTime) / 1000).toFixed(2);
            logger.info(logContext, `[Upload] Completed in ${uploadElapsed}s - Uploaded ${uploadCount}/${daysCount} files`);
            
            // === Generate and Log Report ===
            const report = generateReport(results);
            this.showReportInOutput(report);
            
            // Log the full report
            logger.info(logContext, `[Report] Kiro Code Generation Statistics:`);
            const reportLines = report.split('\n');
            for (const line of reportLines) {
                if (line.trim()) {
                    logger.info(logContext, `[Report] ${line}`);
                }
            }
            
            // === Summary ===
            const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(2);
            logger.info(logContext, `========== Operation Completed ==========`);
            logger.info(logContext, `Total Time: ${totalElapsed}s (Scan: ${scanElapsed}s, Upload: ${uploadElapsed}s)`);
            logger.info(logContext, `Files Uploaded: ${uploadCount}/${daysCount}`);
            
            vscode.window.showInformationMessage(`${filterLabel} metrics exported successfully! Uploaded ${uploadCount} files.`);
        } catch (error: any) {
            const totalElapsed = ((Date.now() - totalStartTime) / 1000).toFixed(2);
            logger.error(logContext, `========== Operation Failed ==========`);
            logger.error(logContext, `Error: ${error.message || error}`);
            logger.error(logContext, `Time elapsed before failure: ${totalElapsed}s`);
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
     * s3://bucketName/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/year/month/day/00/kiro-ide-{userid}.csv
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
        
        // Build the key following the pattern (without timestamp for idempotent uploads)
        const key = `${basePath}/${year}/${month}/${day}/00/kiro-ide-${userId}.csv`;

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

    private async uploadDayCSVToS3(csvData: string, date: string, userId: string, s3Prefix: string, filterType?: 'lastWeek' | 'allTillYesterday'): Promise<void> {
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
            
            const filterLabel = filterType ? ` (${filterType === 'allTillYesterday' ? 'all till yesterday' : 'last week'})` : '';
            vscode.window.showInformationMessage(
                `✅ Successfully uploaded CSV for ${date}${filterLabel} to S3: s3://${bucket}/${key}`
            );
            
            console.log(`CSV metrics uploaded successfully (idempotent):
                S3: s3://${bucket}/${key}
                Date: ${date}
                User ID: ${userId}
                Filter: ${filterType || 'all'}
                Uploaded at: ${new Date().toISOString()}`);
                
        } catch (error: any) {
            throw new Error(`S3 CSV upload failed for ${date}: ${error.message || error}`);
        }
    }

}