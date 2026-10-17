# EaseDo

[简体中文](README.md) | [English](README.en.md)

ADHD 友好的「注意力 0 负荷」桌面便签：纯 TXT 记事 + 可点击 To-do + 全程自动留痕。Today 视图写当下，Trace 视图回看任务一生，一键导出周报月报。

## 设计初心：给容易分心的人

这个工具的原点是一个很简单的诉求：**写东西的时候，别让工具本身分走我的注意力。**

很多待办应用对容易分心的大脑（无论是否 ADHD）反而是一种负担——打开就是满屏未读、红点、逾期警告、连续打卡，任务还没开始写，认知负荷先上来了。EaseDo 按相反的逻辑设计：

- **打开即写**：启动后视野内没有任何文字、按钮、红点。侧栏、日期、提示语全部隐藏在悬停手势后面，唯一的动作就是打字
- **一天一页**：Today 只看今天。昨天的未完成事项不会追着你显示，需要时右键导入即可
- **零压力**：没有连续打卡、没有逾期标红、没有进度羞辱——中断一周回来，页面照样空白干净
- **纯 TXT**：数据就是你写得出来的普通文本文件，记事本可直接打开，不存在「被工具绑架」
- **事后回看而非实时催促**：Trace 视图和周报月报把「追踪」放在你主动去看的时候，而不是推送来打断你

> 注意力管理因人而异：本项目不是医疗工具，也不做任何诊断。如果你也容易被界面本身分心，这套设计逻辑应该适合你。

## 数据位置

`文档\EaseDo\`

```
EaseDo/
  notes/2026-10-16.txt     每天一个纯文本文件，记事本可直接打开
  trace/snapshots.jsonl    任务快照流水账（自动追加，含 .prev 回退副本）
  export/                  周报 / 月报导出目录（Markdown + HTML）
```

TXT 内语法：`- [ ] 任务` / `- [x] 完成`，两空格缩进为子任务，`# 标题` 为时段标签。

## 每日清空与往日导入

- **业务日分界 6:00**：「今天」以凌晨 6 点划分——6 点前写的归前一天，深夜工作不被零点打断。跨分界点应用每 30 秒自动翻页到新一天的空白页（旧内容先落盘）；Trace 按天归组、周报月报统计、导入分组均使用同一分界
- **每日一页**：Today 视图一天一个 txt，当天没写过就是空白
- **右键导入**：编辑器右键 →「导入往日未完成…」→ 按天分组列出往日未完成任务（已完成的、已删除的不出现），勾选带回今天
- 导入**沿用原任务身份**：Trace 里仍是同一条任务的一生（时间线多一条「导入 · 来自 某日」），周报月报不计为新创建、只计入「进行中」

## 极简视图

- 启动即一块纯输入区：侧栏隐藏（贴左缘 14px 热区呼出，作为浮层滑入）、日期与进度条隐藏（悬停顶部渐显）、底部操作提示隐藏（仅悬停提示文字本身才浮现）——默认视野内除空复选框外无任何文字，打字时零干扰
- **无边框极简模式**：默认隐藏系统标题栏，顶部悬停日期区或窗口顶边可拖动（双击最大化），右上角悬停浮现最小化 / 关闭按钮；设置页可关闭此模式换回传统标题栏
- **可缩到便签大小**：窗口最小 280×200；窄窗口（≤620px）自动收紧边距、Trace 日期栏折叠为横向、报告改单列，内容始终填满无空隙

## 设置页

侧栏齿轮打开，分三区，外观与窗口项即时生效：

- **外观**：主题（跟随系统 / 浅色 / 深色，不再强制跟随系统）、正文字体（无衬线 / 衬线 / 等宽）、正文字号（12–20px 滑杆，带实时预览）
- **窗口与系统**：窗口置顶（Always on Top）、隐藏标题栏（无边框极简，即时生效）、托盘常驻（点关闭缩到系统托盘，左键托盘图标恢复，菜单含显示 / 退出）、开机自启（写入当前用户注册表 Run 键，无需管理员）
- **存储**：自定义存储目录（填绝对路径即把 notes / trace / export 落到该目录，保存后自动重载；「恢复默认」回到 `文档\EaseDo`，切换不删除旧数据）
- 全部设置存于 `%APPDATA%\EaseDo\config.json`，键值合并写入，与数据目录解耦；置顶与托盘在应用启动时自动恢复

## 下载

从 [Releases](https://github.com/huangxp12/easedo/releases) 下载 `easedo-v0.2.0-win64.zip`（约 1.5 MB，免安装），解压后得到 `easedo.exe` 与 `WebView2Loader.dll`（两个文件须放在同一目录）：

- 系统要求：Windows 10 / 11（WebView2 运行时系统自带，无需额外安装）
- 双击 `easedo.exe` 即用；数据落在 `文档\EaseDo\`，卸载即删，全程零联网
- 实测运行内存约 36MB

## 从源码构建

标准 Windows 环境（MSVC 工具链，多数开发者适用）：

```bash
# 1. 安装 Rust（rustup，选默认 MSVC 工具链）
#    https://rustup.rs ；MSVC 链接器来自 Visual Studio Build Tools（勾选「使用 C++ 的桌面开发」负载）
# 2. 克隆并构建
git clone https://github.com/huangxp12/easedo.git
cd easedo/src-tauri
cargo build --release
# 产物：target/release/easedo.exe
```

前端为纯静态文件（HTML/CSS/JS），没有 npm 安装与前端构建步骤，Rust 编译时自动打包资源——装好 Rust 即可一键构建。

### 本机开发环境备查（GNU 工具链方案）

无 MSVC 环境时可用 w64devkit（便携 MinGW）替代，以下为已验证的配置（非一般用户必需）：

依赖：Rust stable（x86_64-pc-windows-gnu）+ w64devkit（便携 MinGW，位于 `~/.workbuddy/binaries/mingw64/w64devkit`），无需管理员权限。

```bash
export PATH="$HOME/.cargo/bin:$HOME/.workbuddy/binaries/mingw64/w64devkit/bin:$PATH"
export RUSTFLAGS="-Clink-self-contained=n -Cdlltool=C:/Users/huang/.workbuddy/binaries/mingw64/w64devkit/bin/dlltool.exe"
```

工具链说明：rustup 自包含组件缺 `as.exe`（dlltool 依赖）；w64devkit 缺 `libgcc_eh.a`（已在 `lib/gcc/x86_64-w64-mingw32/16.2.0/` 下用 libgcc.a 复制补齐）。RUSTFLAGS 关闭 Rust 自包含链接，CRT 与导入库全部由 w64devkit 提供。

窗口操作权限：`capabilities/default.json` 在 `core:default` 之外显式放行 `core:window:allow-minimize / allow-close / allow-set-decorations / allow-start-dragging / allow-internal-toggle-maximize`（Tauri 2 默认权限集仅含查询类操作，无边框窗控与拖动必需这几项写权限）。

```bash
cd src-tauri
cargo build          # 调试构建，产物在 target/debug/easedo.exe
cargo build --release  # 发布构建（opt-level=s + lto + strip）
cargo run            # 直接启动
```

## 架构

| 层 | 位置 | 职责 |
|---|---|---|
| 数据层 | `src-tauri/src/store.rs` | 数据目录解析、原子写（tmp + rename）、快照追加与启动校验、受限路径写、设置键值合并读写、注册表自启 |
| 命令层 | `src-tauri/src/main.rs` | Tauri commands：app_init / load_day / save_day / append_events / load_events / list_days / save_file / get_settings / set_setting；系统托盘与窗口置顶、关闭驻留拦截 |
| 存储适配 | `src/core.js` | Tauri 命令调用与浏览器预览模式（localStorage）双通道 |
| 编辑器 | `src/editor.js` | 行级编辑、隐形任务 ID 与身份匹配、快照事件生成、防抖落盘 |
| Trace | `src/trace.js` | 按天回看任务一生（时间线） |
| 报告 | `src/report.js` | 周报 / 月报汇总，Markdown + HTML 双格式导出 |

## 可靠性机制

- `notes/*.txt` 原子写：任何时刻磁盘上都是完整的旧版或新版
- `snapshots.jsonl` 追加写 + 启动校验：末尾撕裂行自动截断，`.prev` 为上一份副本
- 写入顺序：先落状态（txt），后记历史（快照）——崩溃最坏损失一笔历史事件，当前状态始终正确
- 全库 UTF-8（无 BOM），与记事本 / VS Code 双向兼容
