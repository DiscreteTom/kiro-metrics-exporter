/**
 * Kiro Metrics Extractor - TypeScript 版本
 * 
 * 提取 Kiro 代码生成统计数据
 */

import * as fs from 'fs';
import * as path from 'path';
import * as Diff from 'diff';
import {
  ExecutionResult,
  ToolUse,
  ExecutionLog,
  DailyStats,
  MonthlyStats,
  Summary,
  MetricsExport
} from './types';

/**
 * 计算文本行数
 */
export function countLines(text: string): number {
  if (!text) return 0;
  return text.trim().split('\n').length;
}

/**
 * 计算 strReplace 操作的行数变化
 * 使用与 Python difflib.unified_diff 一致的算法
 */
export function calculateStrReplaceLines(oldStr: string, newStr: string): { added: number; deleted: number } {
  if (!oldStr && !newStr) {
    return { added: 0, deleted: 0 };
  }

  const oldLines = (oldStr || '').split('\n');
  const newLines = (newStr || '').split('\n');

  // 使用 diffArrays 进行逐行对比（与 Python unified_diff 行为一致）
  const changes = Diff.diffArrays(oldLines, newLines);
  
  let added = 0;
  let deleted = 0;

  for (const change of changes) {
    if (change.added) {
      added += change.count || 0;
    } else if (change.removed) {
      deleted += change.count || 0;
    }
  }

  return { added, deleted };
}

/**
 * 从 messages 中提取 tool use，去重处理
 */
function extractToolUsesFromMessages(
  messages: Array<{ entries?: Array<{ type?: string; name?: string; id?: string; args?: Record<string, unknown> }> }> | undefined,
  seenToolIds: Set<string>
): ToolUse[] {
  const toolUses: ToolUse[] = [];

  if (!messages) return toolUses;

  for (const msg of messages) {
    const entries = msg.entries || [];
    for (const entry of entries) {
      if (entry.type === 'toolUse') {
        const toolId = entry.id;
        const toolName = entry.name;

        // 去重：跳过已处理的 tool use
        if (toolId && seenToolIds.has(toolId)) {
          continue;
        }

        if (toolName === 'fsWrite' || toolName === 'strReplace') {
          if (toolId) {
            seenToolIds.add(toolId);
          }
          toolUses.push({
            id: toolId,
            name: toolName,
            args: entry.args as ToolUse['args']
          });
        }
      }
    }
  }

  return toolUses;
}

/**
 * 从 actions 数组中提取文件操作
 */
function extractToolUsesFromActions(
  actions: ExecutionLog['actions'],
  seenToolIds: Set<string>
): ToolUse[] {
  const toolUses: ToolUse[] = [];

  if (!actions) return toolUses;

  for (const action of actions) {
    const actionType = action.actionType;
    const actionId = action.actionId;

    if (actionType === 'create' && actionId) {
      if (seenToolIds.has(actionId)) {
        continue;
      }

      seenToolIds.add(actionId);

      const input = action.input || {};
      if (input.modifiedContent) {
        toolUses.push({
          id: actionId,
          name: 'fsWrite',
          args: {
            path: input.file || '',
            text: input.modifiedContent
          },
          emittedAt: action.emittedAt
        });
      }
    }
  }

  return toolUses;
}


/**
 * 处理单个执行日志文件
 */
export function processExecutionLog(
  filePath: string,
  seenExecutionIds: Set<string>
): ExecutionResult | null {
  let data: ExecutionLog;

  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    data = JSON.parse(content);
  } catch {
    return null;
  }

  const executionId = data.executionId;
  if (!executionId) {
    return null;
  }

  // 去重：跳过已处理的 execution
  if (seenExecutionIds.has(executionId)) {
    return null;
  }
  seenExecutionIds.add(executionId);

  // 提取时间信息
  let startTime: Date | null = null;
  let endTime: Date | null = null;

  if (data.startTime) {
    startTime = new Date(data.startTime);
  }
  if (data.endTime || data.metadata?.endTime) {
    endTime = new Date(data.endTime || data.metadata!.endTime!);
  }

  const result: ExecutionResult = {
    executionId,
    startTime,
    endTime,
    status: data.status || 'unknown',
    workflowType: data.workflowType || 'unknown',
    fsWriteLines: 0,
    strReplaceAdded: 0,
    strReplaceDeleted: 0,
    fileOperations: []
  };

  const seenToolIds = new Set<string>();

  // 从 actions 中提取
  const actionsToolUses = extractToolUsesFromActions(data.actions, seenToolIds);

  // 从 context.messages 中提取
  const messagesToolUses = extractToolUsesFromMessages(
    data.context?.messages,
    seenToolIds
  );

  const allToolUses = [...actionsToolUses, ...messagesToolUses];

  // 处理 tool uses
  for (const toolUse of allToolUses) {
    const toolName = toolUse.name;
    const args = toolUse.args || {};

    if (toolName === 'fsWrite') {
      const text = args.text || '';
      const lines = countLines(text);
      result.fsWriteLines += lines;
      result.fileOperations.push({
        type: 'fsWrite',
        path: args.path || '',
        lines
      });
    } else if (toolName === 'strReplace') {
      const oldStr = args.oldStr || '';
      const newStr = args.newStr || '';
      const { added, deleted } = calculateStrReplaceLines(oldStr, newStr);
      result.strReplaceAdded += added;
      result.strReplaceDeleted += deleted;
      result.fileOperations.push({
        type: 'strReplace',
        path: args.path || '',
        added,
        deleted
      });
    }
  }

  return result;
}

/**
 * 扫描 kiro.kiroagent 目录，提取所有执行日志
 */
export function scanKiroAgentDirectory(basePath: string): ExecutionResult[] {
  const results: ExecutionResult[] = [];
  const seenExecutionIds = new Set<string>();

  // 查找所有 hash 命名的会话文件夹
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(basePath, { withFileTypes: true });
  } catch {
    console.error(`无法读取目录: ${basePath}`);
    return results;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    // 执行日志在 {hash}/414d1636299d2b9e4ce7e17fb11f63e9/ 目录下
    const logDir = path.join(basePath, entry.name, '414d1636299d2b9e4ce7e17fb11f63e9');

    if (!fs.existsSync(logDir)) continue;

    let logFiles: fs.Dirent[];
    try {
      logFiles = fs.readdirSync(logDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const logFile of logFiles) {
      if (!logFile.isFile()) continue;

      const logFilePath = path.join(logDir, logFile.name);
      const result = processExecutionLog(logFilePath, seenExecutionIds);

      if (result && (result.fsWriteLines > 0 || result.strReplaceAdded > 0 || result.strReplaceDeleted > 0)) {
        results.push(result);
      }
    }
  }

  return results;
}

/**
 * 格式化日期为本地时间字符串 YYYY-MM-DD
 */
function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * 格式化日期为本地时间字符串 YYYY-MM
 */
function formatLocalMonth(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

/**
 * 格式化日期为本地 ISO 格式字符串
 */
function formatLocalISOString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  const seconds = String(date.getSeconds()).padStart(2, '0');
  const ms = String(date.getMilliseconds()).padStart(3, '0');
  return `${year}-${month}-${day}T${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * 按日期聚合统计
 */
export function aggregateByDate(results: ExecutionResult[]): Record<string, DailyStats> {
  const dailyStats: Record<string, DailyStats> = {};

  for (const r of results) {
    if (!r.startTime) continue;

    const dateKey = formatLocalDate(r.startTime);

    if (!dailyStats[dateKey]) {
      dailyStats[dateKey] = {
        fsWriteLines: 0,
        strReplaceAdded: 0,
        strReplaceDeleted: 0,
        executionCount: 0,
        filesCreated: 0,
        filesModified: 0
      };
    }

    dailyStats[dateKey].fsWriteLines += r.fsWriteLines;
    dailyStats[dateKey].strReplaceAdded += r.strReplaceAdded;
    dailyStats[dateKey].strReplaceDeleted += r.strReplaceDeleted;
    dailyStats[dateKey].executionCount += 1;

    for (const op of r.fileOperations) {
      if (op.type === 'fsWrite') {
        dailyStats[dateKey].filesCreated += 1;
      } else {
        dailyStats[dateKey].filesModified += 1;
      }
    }
  }

  return dailyStats;
}

/**
 * 按月份聚合统计
 */
export function aggregateByMonth(results: ExecutionResult[]): Record<string, MonthlyStats> {
  const monthlyData: Record<string, {
    fsWriteLines: number;
    strReplaceAdded: number;
    strReplaceDeleted: number;
    executionCount: number;
    filesCreated: number;
    filesModified: number;
    activeDays: Set<string>;
  }> = {};

  for (const r of results) {
    if (!r.startTime) continue;

    const monthKey = formatLocalMonth(r.startTime);
    const dateKey = formatLocalDate(r.startTime);

    if (!monthlyData[monthKey]) {
      monthlyData[monthKey] = {
        fsWriteLines: 0,
        strReplaceAdded: 0,
        strReplaceDeleted: 0,
        executionCount: 0,
        filesCreated: 0,
        filesModified: 0,
        activeDays: new Set()
      };
    }

    monthlyData[monthKey].fsWriteLines += r.fsWriteLines;
    monthlyData[monthKey].strReplaceAdded += r.strReplaceAdded;
    monthlyData[monthKey].strReplaceDeleted += r.strReplaceDeleted;
    monthlyData[monthKey].executionCount += 1;
    monthlyData[monthKey].activeDays.add(dateKey);

    for (const op of r.fileOperations) {
      if (op.type === 'fsWrite') {
        monthlyData[monthKey].filesCreated += 1;
      } else {
        monthlyData[monthKey].filesModified += 1;
      }
    }
  }

  // 转换为最终格式
  const monthlyStats: Record<string, MonthlyStats> = {};
  for (const [month, stats] of Object.entries(monthlyData)) {
    monthlyStats[month] = {
      fsWriteLines: stats.fsWriteLines,
      strReplaceAdded: stats.strReplaceAdded,
      strReplaceDeleted: stats.strReplaceDeleted,
      netLines: stats.fsWriteLines + stats.strReplaceAdded - stats.strReplaceDeleted,
      executionCount: stats.executionCount,
      filesCreated: stats.filesCreated,
      filesModified: stats.filesModified,
      activeDays: stats.activeDays.size
    };
  }

  return monthlyStats;
}

/**
 * 生成统计摘要
 */
export function generateSummary(results: ExecutionResult[]): Summary {
  const totalFsWriteLines = results.reduce((sum, r) => sum + r.fsWriteLines, 0);
  const totalStrReplaceAdded = results.reduce((sum, r) => sum + r.strReplaceAdded, 0);
  const totalStrReplaceDeleted = results.reduce((sum, r) => sum + r.strReplaceDeleted, 0);

  return {
    totalExecutions: results.length,
    totalFsWriteLines,
    totalStrReplaceAdded,
    totalStrReplaceDeleted,
    netLines: totalFsWriteLines + totalStrReplaceAdded - totalStrReplaceDeleted
  };
}

/**
 * 导出为 JSON 格式
 */
export function exportToJson(results: ExecutionResult[]): MetricsExport {
  return {
    generatedAt: formatLocalISOString(new Date()),
    summary: generateSummary(results),
    monthlyStats: aggregateByMonth(results),
    dailyStats: aggregateByDate(results),
    executions: results.map(r => ({
      executionId: r.executionId,
      startTime: r.startTime ? formatLocalISOString(r.startTime) : null,
      endTime: r.endTime ? formatLocalISOString(r.endTime) : null,
      status: r.status,
      workflowType: r.workflowType,
      fsWriteLines: r.fsWriteLines,
      strReplaceAdded: r.strReplaceAdded,
      strReplaceDeleted: r.strReplaceDeleted,
      fileOperations: r.fileOperations
    }))
  };
}

/**
 * 生成文本报告
 */
export function generateReport(results: ExecutionResult[]): string {
  if (results.length === 0) {
    return '没有找到任何代码生成记录。';
  }

  const summary = generateSummary(results);
  const monthlyStats = aggregateByMonth(results);
  const dailyStats = aggregateByDate(results);

  const lines: string[] = [];

  lines.push('='.repeat(70));
  lines.push('Kiro 代码生成统计报告');
  lines.push('='.repeat(70));
  lines.push('');
  lines.push('## 总体统计');
  lines.push(`- 总执行次数: ${summary.totalExecutions}`);
  lines.push(`- fsWrite 新建文件总行数: ${summary.totalFsWriteLines}`);
  lines.push(`- strReplace 新增行数: ${summary.totalStrReplaceAdded}`);
  lines.push(`- strReplace 删除行数: ${summary.totalStrReplaceDeleted}`);
  lines.push(`- 净增代码行数: ${summary.netLines}`);
  lines.push('');

  // 按月统计
  lines.push('## 按月统计');
  lines.push('-'.repeat(70));
  lines.push(`${'月份'.padEnd(10)} ${'新建行数'.padEnd(10)} ${'修改+行'.padEnd(10)} ${'修改-行'.padEnd(10)} ${'净增行数'.padEnd(10)} ${'执行次数'.padEnd(8)}`);
  lines.push('-'.repeat(70));

  const sortedMonths = Object.keys(monthlyStats).sort();
  for (const month of sortedMonths) {
    const stats = monthlyStats[month];
    lines.push(
      `${month.padEnd(10)} ${String(stats.fsWriteLines).padEnd(10)} ` +
      `${String(stats.strReplaceAdded).padEnd(10)} ${String(stats.strReplaceDeleted).padEnd(10)} ` +
      `${String(stats.netLines).padEnd(10)} ${String(stats.executionCount).padEnd(8)}`
    );
  }
  lines.push('-'.repeat(70));
  lines.push('');

  // 按日期统计
  lines.push('## 按日期统计');
  lines.push('-'.repeat(70));
  lines.push(`${'日期'.padEnd(12)} ${'新建行数'.padEnd(10)} ${'修改+行'.padEnd(10)} ${'修改-行'.padEnd(10)} ${'执行次数'.padEnd(8)}`);
  lines.push('-'.repeat(70));

  const sortedDates = Object.keys(dailyStats).sort();
  for (const date of sortedDates) {
    const stats = dailyStats[date];
    lines.push(
      `${date.padEnd(12)} ${String(stats.fsWriteLines).padEnd(10)} ` +
      `${String(stats.strReplaceAdded).padEnd(10)} ${String(stats.strReplaceDeleted).padEnd(10)} ` +
      `${String(stats.executionCount).padEnd(8)}`
    );
  }
  lines.push('-'.repeat(70));

  return lines.join('\n');
}
