import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export class Logger {
    private static instance: Logger;
    private logDir: string;

    private constructor() {
        this.logDir = path.join(os.homedir(), '.kiro-metrics-exporter', 'logs');
        this.ensureLogDir();
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    private ensureLogDir(): void {
        if (!fs.existsSync(this.logDir)) {
            fs.mkdirSync(this.logDir, { recursive: true });
        }
    }

    private getLogFilePath(): string {
        const date = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        return path.join(this.logDir, `metrics-exporter-${date}.log`);
    }

    private formatMessage(level: LogLevel, context: string, message: string): string {
        const timestamp = new Date().toISOString();
        return `[${timestamp}] [${level}] [${context}] ${message}\n`;
    }

    log(level: LogLevel, context: string, message: string): void {
        const formatted = this.formatMessage(level, context, message);
        const logFile = this.getLogFilePath();
        fs.appendFileSync(logFile, formatted, 'utf8');
    }

    info(context: string, message: string): void {
        this.log('INFO', context, message);
    }

    warn(context: string, message: string): void {
        this.log('WARN', context, message);
    }

    error(context: string, message: string): void {
        this.log('ERROR', context, message);
    }

    getLogDir(): string {
        return this.logDir;
    }

    getCurrentLogFile(): string {
        return this.getLogFilePath();
    }
}

export const logger = Logger.getInstance();
