import * as vscode from 'vscode';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import * as fs from 'fs';
import * as path from 'path';

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

    async exportMetrics() {
        vscode.window.showInformationMessage('Starting metrics export...');

        if (!this.initializeS3()) {
            return;
        }

        try {
            // Mock: Scan local directory for metrics
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage('No workspace folder found');
                return;
            }

            const metrics = await this.scanDirectoryForMetrics(workspaceFolder.uri.fsPath);
            
            // Mock: Upload to S3
            await this.uploadMetricsToS3(metrics);
            
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

    private async scanDirectoryForMetrics(dirPath: string): Promise<any> {
        // Mock implementation - in real scenario, this would scan files and extract actual metrics
        const mockMetrics = {
            timestamp: new Date().toISOString(),
            directory: dirPath,
            fileCount: await this.countFiles(dirPath),
            totalSize: await this.calculateDirectorySize(dirPath),
            fileTypes: await this.getFileTypeDistribution(dirPath),
            lastModified: new Date().toISOString()
        };

        vscode.window.showInformationMessage(`Scanned directory: ${dirPath}`);
        return mockMetrics;
    }

    private async countFiles(dirPath: string): Promise<number> {
        // Mock file counting
        try {
            const files = fs.readdirSync(dirPath, { withFileTypes: true });
            let count = 0;
            
            for (const file of files) {
                if (file.isFile()) {
                    count++;
                } else if (file.isDirectory() && !file.name.startsWith('.')) {
                    count += await this.countFiles(path.join(dirPath, file.name));
                }
            }
            
            return count;
        } catch {
            return 0;
        }
    }

    private async calculateDirectorySize(dirPath: string): Promise<number> {
        // Mock size calculation
        try {
            const files = fs.readdirSync(dirPath, { withFileTypes: true });
            let size = 0;
            
            for (const file of files) {
                const filePath = path.join(dirPath, file.name);
                if (file.isFile()) {
                    const stats = fs.statSync(filePath);
                    size += stats.size;
                } else if (file.isDirectory() && !file.name.startsWith('.')) {
                    size += await this.calculateDirectorySize(filePath);
                }
            }
            
            return size;
        } catch {
            return 0;
        }
    }

    private async getFileTypeDistribution(dirPath: string): Promise<Record<string, number>> {
        // Mock file type distribution
        const distribution: Record<string, number> = {};
        
        try {
            const files = fs.readdirSync(dirPath, { withFileTypes: true });
            
            for (const file of files) {
                if (file.isFile()) {
                    const ext = path.extname(file.name) || 'no-extension';
                    distribution[ext] = (distribution[ext] || 0) + 1;
                } else if (file.isDirectory() && !file.name.startsWith('.')) {
                    const subDistribution = await this.getFileTypeDistribution(path.join(dirPath, file.name));
                    for (const [ext, count] of Object.entries(subDistribution)) {
                        distribution[ext] = (distribution[ext] || 0) + count;
                    }
                }
            }
        } catch {
            // Ignore errors
        }
        
        return distribution;
    }

    private async uploadMetricsToS3(metrics: any): Promise<void> {
        if (!this.s3Client) {
            throw new Error('S3 client not initialized');
        }

        // Mock S3 upload - in real scenario, this would actually upload to S3
        const bucketName = 'kiro-metrics-bucket'; // This should be configurable
        const key = `metrics/${Date.now()}-metrics.json`;
        
        // Simulate upload delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        
        // Mock successful upload
        vscode.window.showInformationMessage(`Mock upload to S3: s3://${bucketName}/${key}`);
        console.log('Mock metrics data:', JSON.stringify(metrics, null, 2));

        // Uncomment below for actual S3 upload:
        /*
        const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: key,
            Body: JSON.stringify(metrics, null, 2),
            ContentType: 'application/json'
        });

        try {
            await this.s3Client.send(command);
            vscode.window.showInformationMessage(`Successfully uploaded to S3: s3://${bucketName}/${key}`);
        } catch (error) {
            throw new Error(`S3 upload failed: ${error}`);
        }
        */
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