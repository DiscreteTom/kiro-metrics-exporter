# Kiro 指标导出器

[![Version](https://img.shields.io/badge/version-1.1.4-blue.svg)](https://github.com/DiscreteTom/kiro-metrics-exporter)

一个将 Kiro IDE 使用指标导出到 AWS S3 的 VSCode 扩展。

## 功能特性

- **📊 专属活动栏面板**：通过侧边栏图标快速访问
- **📋 分步配置流程**：4 步组织化工作流，轻松设置
- **👤 自动用户解析**：输入用户名，自动解析 User ID 和显示名称
- **🔍 S3 权限检查**：上传前验证写入权限
- **📝 操作日志记录**：详细日志便于故障排查
- **📤 时间过滤导出**：上传最近 7 天或全部历史数据
- **☁️ AWS S3 集成**：以 CSV 格式上传指标数据

## v1.1.x 新功能

- **活动栏图标**：指标导出器专属侧边栏图标
- **4 步配置流程**：AWS 凭证 → 用户身份 → S3 配置 → 日志与设置
- **用户名解析**：从用户名自动解析 User ID 和显示名称
- **S3 权限检查**：上传前验证 S3 写入权限
- **操作日志**：完整日志保存至 `~/.kiro-metrics-exporter/logs/`
- **设置页改进**：有序排列的配置项，可点击的操作链接

## 设置指南

### 第一步：AWS 凭证

1. 点击活动栏（左侧边栏）中的 **📊 Metrics Exporter** 图标
2. 展开 **Step 1: AWS Credentials**
3. 配置以下项目：
   - **Access Key**：您的 AWS 访问密钥 ID
   - **Secret Key**：您的 AWS 秘密访问密钥
   - **Identity Store ID**：您的 AWS Identity Store ID（例如：`d-1234567890`）
   - **Identity Store Region**：Identity Store 所在区域（默认：`us-east-1`）

### 第二步：用户身份

1. 展开 **Step 2: User Identity**
2. 点击 **Username** 并输入您的用户名
3. 点击 **🔄 Resolve User ID & Display Name**
4. User ID 和显示名称将自动填充

### 第三步：S3 配置

1. 展开 **Step 3: S3 Configuration**
2. 配置以下项目：
   - **S3 Prefix**：完整 S3 路径（例如：`s3://bucket/prefix/AWSLogs/accountId/KiroLogs/by_user_analytic/Region/`）
   - **S3 Region**：S3 操作所在区域（默认：`us-east-1`）
3. 点击 **🔍 Check S3 Write Permission** 验证访问权限

### 第四步：日志与设置

- **📄 Open Log File**：查看今日操作日志
- **📂 Open Log Folder**：打开日志目录
- **⚙️ Open Settings**：快速访问扩展设置

## 使用方法

### 导出指标

使用面板标题中的按钮：

| 按钮 | 说明 |
|------|------|
| ⏱️ Upload Last 7 Days | 导出 T-7 到 T-1 的指标 |
| 📤 Upload All Till Yesterday | 导出到 T-1 为止的所有可用数据 |

### CSV 输出格式

| 列名 | 说明 |
|------|------|
| UserId | AWS Identity Center 用户 ID |
| Date | MM-DD-YYYY 格式的日期 |
| Chat_AICodeLines | AI 生成代码的净行数 |
| Chat_MessagesSent | 执行次数 |
| 其他列 | 设置为 0（兼容性考虑） |

### S3 路径结构

```
{s3Prefix}/{year}/{month}/{day}/00/kiro-ide-{userId}.csv
```

示例：
```
s3://bucket/prefix/AWSLogs/123456789012/KiroLogs/by_user_analytic/us-east-1/2025/01/04/00/kiro-ide-abc123.csv
```

**注意**：上传是幂等的 - 相同日期/用户组合使用相同路径。

## 操作日志

日志保存位置：`~/.kiro-metrics-exporter/logs/metrics-exporter-YYYY-MM-DD.log`

日志内容包括：
- 操作开始/结束时间戳
- 用户和 S3 配置信息
- 扫描进度和结果
- 上传进度（N/M 文件）
- 耗时统计

日志示例：
```
[2025-01-04T10:30:00.000Z] [INFO] [Upload Last 7 Days] ========== Operation Started ==========
[2025-01-04T10:30:00.001Z] [INFO] [Upload Last 7 Days] User: john.doe, UserId: xxx-xxx
[2025-01-04T10:30:01.000Z] [INFO] [Upload Last 7 Days] [Scanning] Completed in 1.00s - Found 50 records
[2025-01-04T10:30:02.000Z] [INFO] [Upload Last 7 Days] [Upload] 1/7 - 2025-01-03 -> s3://bucket/path/file.csv
```

## 系统要求

### AWS 权限

| 服务 | 权限 | 用途 |
|------|------|------|
| S3 | `PutObject` | 上传 CSV 文件 |
| S3 | `DeleteObject` | 清理测试文件（权限检查） |
| Identity Store | `GetUserId` | 从用户名解析 User ID |
| Identity Store | `DescribeUser` | 获取显示名称 |

### Kiro Agent 数据位置

| 平台 | 路径 |
|------|------|
| Windows | `%APPDATA%\Kiro\User\globalStorage\kiro.kiroagent` |
| macOS | `~/Library/Application Support/Kiro/User/globalStorage/kiro.kiroagent` |
| Linux | `~/.config/Kiro/User/globalStorage/kiro.kiroagent` |

## 开发

```bash
# 安装依赖
npm install

# 编译 TypeScript
npm run compile

# 监听变化
npm run watch
```

## 测试

1. 按 `F5` 打开扩展开发主机窗口
2. 点击活动栏中的 **📊 Metrics Exporter** 图标
3. 按照 4 个步骤配置 AWS 设置
4. 测试上传功能

## 故障排查

### 常见问题

| 问题 | 解决方案 |
|------|----------|
| 用户解析失败 | 检查 Identity Store ID 和凭证 |
| S3 权限被拒绝 | 验证 IAM 策略是否有 PutObject 权限 |
| 未找到数据 | 确保 Kiro agent 目录存在且有活动数据 |
| 上传失败 | 检查 S3 前缀格式（必须以 `s3://` 开头） |

### 查看日志

1. 点击第四步中的 **📄 Open Log File**
2. 或导航至 `~/.kiro-metrics-exporter/logs/`

## 更新日志

查看 [CHANGELOG.md](CHANGELOG.md) 了解版本历史。

## 许可证

MIT

## 致谢

原始项目作者：[DiscreteTom](https://github.com/DiscreteTom/kiro-metrics-exporter)
