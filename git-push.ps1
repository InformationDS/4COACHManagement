<#
.SYNOPSIS
    自动化 git 提交并推送到 GitHub
.DESCRIPTION
    自动检测更改类型，生成规范化的 Conventional Commit 提交信息，暂存、提交并推送到远程仓库。
.PARAMETER Message
    提交信息描述（必填）。脚本会自动添加 conventional commit 前缀。
.PARAMETER Type
    提交类型（可选）：feat, fix, docs, style, refactor, perf, test, build, ci, chore, revert
    不指定则根据 message 关键词自动推断。
.PARAMETER Scope
    影响范围（可选），如：cloudfunctions, components, pages, utils
.PARAMETER Branch
    推送的目标分支（默认：当前分支）
.PARAMETER NoPush
    仅提交不推送
.PARAMETER DryRun
    预览模式，不实际执行
.EXAMPLE
    .\git-push.ps1 "添加学员课程预约功能"
    .\git-push.ps1 -Message "修复日历组件日期选择bug" -Type fix -Scope calendar
    .\git-push.ps1 -Message "更新云函数" -Scope cloudfunctions -NoPush
#>

param(
    [Parameter(Mandatory = $true, Position = 0, HelpMessage = "提交信息描述")]
    [string]$Message,

    [Parameter(Position = 1)]
    [ValidateSet("feat", "fix", "docs", "style", "refactor", "perf", "test", "build", "ci", "chore", "revert")]
    [string]$Type,

    [string]$Scope,

    [string]$Branch,

    [switch]$NoPush,

    [switch]$DryRun
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# ========== 1. 检查 git 仓库状态 ==========
Write-Host "`n===== 检查仓库状态 =====" -ForegroundColor Cyan

$hasRemote = $false
try {
    $remoteUrl = git remote get-url origin 2>$null
    if ($remoteUrl) {
        $hasRemote = $true
        Write-Host "  远程仓库: $remoteUrl" -ForegroundColor Gray
    }
} catch {}

$currentBranch = git branch --show-current 2>$null
if (-not $currentBranch) {
    Write-Host "  错误: 当前不在任何分支上，请先创建分支。" -ForegroundColor Red
    exit 1
}
Write-Host "  当前分支: $currentBranch" -ForegroundColor Gray

$statusOutput = git status --porcelain 2>&1
if (-not $statusOutput) {
    Write-Host "  工作区干净，没有需要提交的更改。" -ForegroundColor Yellow
    exit 0
}

Write-Host "`n  待提交的文件:" -ForegroundColor Gray
$statusOutput | ForEach-Object {
    $prefix = $_.Substring(0, 2)
    $file = $_.Substring(3)
    $color = if ($prefix -match '\?\?') { "Green" } elseif ($prefix -match '^[AM]') { "Yellow" } else { "Red" }
    Write-Host "    $prefix $file" -ForegroundColor $color
}

# ========== 2. 自动推断提交类型 ==========
if (-not $Type) {
    $msgLower = $Message.ToLower()
    if ($msgLower -match '修复|fix|bug|错误|问题|修复|hotfix') {
        $Type = "fix"
    } elseif ($msgLower -match '文档|doc|readme|说明') {
        $Type = "docs"
    } elseif ($msgLower -match '样式|style|css|排版|格式|美化|UI|界面') {
        $Type = "style"
    } elseif ($msgLower -match '重构|refactor|重写|优化结构') {
        $Type = "refactor"
    } elseif ($msgLower -match '性能|perf|优化速度|加速|缓存') {
        $Type = "perf"
    } elseif ($msgLower -match '测试|test|单元测试|用例') {
        $Type = "test"
    } elseif ($msgLower -match '构建|build|依赖|打包|npm|package') {
        $Type = "build"
    } elseif ($msgLower -match 'ci|部署|deploy|流水线|workflow') {
        $Type = "ci"
    } elseif ($msgLower -match '回滚|revert|撤销') {
        $Type = "revert"
    } elseif ($msgLower -match '杂项|chore|维护|清理|gitignore|配置') {
        $Type = "chore"
    } else {
        $Type = "feat"
    }
    Write-Host "`n  自动推断类型: $Type" -ForegroundColor Gray
}

# ========== 3. 生成 commit message ==========
$scopePart = if ($Scope) { "($Scope)" } else { "" }
$commitMsg = "${Type}${scopePart}: $Message"
Write-Host "`n  提交信息: $commitMsg" -ForegroundColor White

# ========== 4. 执行 ==========
if ($DryRun) {
    Write-Host "`n  [DRY RUN] 以上为预览，未实际执行。" -ForegroundColor Yellow
    exit 0
}

# 暂存所有更改
Write-Host "`n===== 暂存更改 =====" -ForegroundColor Cyan
git add -A
Write-Host "  已暂存所有更改" -ForegroundColor Green

# 提交
Write-Host "`n===== 提交 =====" -ForegroundColor Cyan
git commit -m $commitMsg
if ($LASTEXITCODE -ne 0) {
    Write-Host "  提交失败！" -ForegroundColor Red
    exit $LASTEXITCODE
}
Write-Host "  提交成功" -ForegroundColor Green

# 推送
if (-not $NoPush -and $hasRemote) {
    $pushBranch = if ($Branch) { $Branch } else { $currentBranch }
    Write-Host "`n===== 推送到 origin/$pushBranch =====" -ForegroundColor Cyan
    
    # 检查是否有存储的凭据
    $credHelper = git config credential.helper 2>$null
    
    $pushOutput = git push origin "${currentBranch}:${pushBranch}" 2>&1
    $pushExitCode = $LASTEXITCODE
    
    if ($pushExitCode -ne 0) {
        $pushText = "$pushOutput"
        if ($pushText -match "terminal prompts disabled|could not read Username|Authentication failed|403") {
            Write-Host @"

========================================
  推送失败：需要 GitHub 认证
========================================

  请使用以下任一方式配置认证后重试：

  方式1 - 使用 GitHub Personal Access Token（推荐）:
    git remote set-url origin https://TOKEN@github.com/InformationDS/4COACHManagement.git
    （将 TOKEN 替换为你的 GitHub Personal Access Token）

  方式2 - 使用 SSH:
    git remote set-url origin git@github.com:InformationDS/4COACHManagement.git

  方式3 - 手动推送（在终端执行）:
    git push origin $pushBranch
    然后输入你的 GitHub 用户名和密码/Token

  配置完成后运行: .\git-push.ps1 '$Message'
"@ -ForegroundColor Yellow
        } else {
            Write-Host "  推送失败：$pushText" -ForegroundColor Red
        }
        # 不退出，保留本地提交
        Write-Host "  本地提交已完成，推送可稍后重试。" -ForegroundColor Gray
    } else {
        Write-Host "  推送成功！" -ForegroundColor Green
    }
} elseif (-not $hasRemote) {
    Write-Host "`n  未配置远程仓库，跳过推送。" -ForegroundColor Yellow
} else {
    Write-Host "`n  -NoPush 模式，跳过推送。" -ForegroundColor Yellow
}

Write-Host "`n===== 完成 =====" -ForegroundColor Cyan
Write-Host "  提交: $commitMsg" -ForegroundColor White
