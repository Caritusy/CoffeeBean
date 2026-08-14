# CoffeeBean

CoffeeBean 是一个面向 IWPC（Godot 4 Web/WASM）的浏览器 TAS 工具。Git 仓库只保存源码，
完整的游戏文件、碰撞箱录制版本和正常成片版本通过 GitHub Releases 提供，避免每次克隆源码
都下载上百 MB 的运行资源。

## 快速开始

### Windows：下载发布版并一键启动

1. 安装 [Node.js](https://nodejs.org/) 18 或更高版本。只需要 Node.js，不需要执行 `npm install`。
2. 打开 [GitHub Releases](https://github.com/Caritusy/CoffeeBean/releases/latest)，下载
   `CoffeeBean-v*-windows.zip`。
3. 解压 ZIP，双击目录中的 **`启动CoffeeBean.cmd`**。
4. 脚本会启动本地服务器，并自动打开：

   ```text
   http://127.0.0.1:4173/game/iwpc/index.html
   ```

5. 保持启动脚本的命令行窗口开启；关闭窗口即可停止服务器。

### 已下载发布版时使用命令行启动

```powershell
cd CoffeeBean
node test/server.mjs --open
```

如果不希望自动打开浏览器，运行：

```powershell
node test/server.mjs
```

需要更换端口时：

```powershell
$env:COFFEEBEAN_PORT = 5000
node test/server.mjs --open
```

## 开始制作 TAS

页面第一次打开时停在第 0 帧。建议使用 Chromium 内核浏览器，例如 Chrome 或 Edge。

| 操作 | 默认按键 |
|---|---|
| 开始/暂停 | `P` |
| 前进 1 帧 | `Space` |
| 以项目正常速度播放 | `2` |
| 快速保存到槽位 1 | `Q` |
| 快速读取槽位 1 | `W` |
| 左右移动 | `A` / `D` |
| 攻击 | `J` |
| 跳跃 | `K` |
| 游戏内重生 | `R` |

推荐工作流程：

1. 使用页面顶部的 **TAS / Hitboxes** 进入碰撞箱版本。
2. 按 `Space` 逐帧前进，或者按 `P` 以正常速度录制。
3. 使用 `Q`/`W` 快速保存和读取；左侧栏还提供 8 个回放检查点槽位。
4. 读取检查点后，工具会重启内层 Godot/WASM，并按项目帧率回放到保存帧。
5. 回放期间物理键盘和鼠标输入会被拒绝。暂停后点击 **接管录制**，即可从当前帧继续重录。
6. 使用 **保存工程** 导出 `.cbproj`；之后可以在同一页面重新载入。
7. TAS 完成后切换到 **Production / Clean**，使用无碰撞箱版本录制成片。

键盘输入只有按下、保持、松开三种正常状态，不会自动产生 Tap。需要 Tap 时，用鼠标点击页面底部
对应的按键状态块。`Space` 只控制逐帧，不会传给游戏。

## 碰撞箱颜色

| 类型 | 颜色 |
|---|---|
| 致命物 | 红色 |
| 玩家 | 绿色 |
| 按钮、拉杆等交互物 | 紫色 |
| 玩家攻击 | 黑色 |

为避免碰撞箱模式显著降低性能，地图砖块碰撞箱默认不绘制。

## 确定性与回放

- 录制和回放统一使用游戏工程配置的 120 Hz 物理帧率。
- 每一帧都会记录键盘、画布鼠标输入以及 Godot PCG32 随机数状态。
- 回放会严格核对唯一的 Godot PCG32 轨迹；出现第二套 RNG 状态时立即停在首个偏差帧。
- 亚当重锤在两个运行版本中都只保留直拳和升龙：玩家位于高处且在原版攻击距离内时升龙，否则直拳。
- 读取不是恢复不完整的 WASM 内存快照，而是销毁并重新创建游戏 iframe，再以正常速度确定性回放。
- 回放可以暂停，并切换到录制模式接管当前路线。
- 实验性快进目前禁用，因为它会破坏 IWPC 的异步场景和节拍系统。

## 两种游戏运行版本

| 页面模式 | 游戏包 | 用途 |
|---|---|---|
| TAS / Hitboxes | `game/iwpc/index_hitbox.pck` | TAS 录制、碰撞判定、Boss 无敌帧/下一招与 RNG 轨迹观察 |
| Production / Clean | `game/iwpc/index_charge_fast.pck` | 与 TAS 版相同游戏逻辑的无碰撞箱成片录制 |

发布版还包含原始游戏包 `game/iwpc/index.pck`。这些 PCK 与 WASM 运行资源不会进入 Git 历史。

## 源码仓库与发布包

直接克隆源码仓库适合修改 CoffeeBean，但不会取得 IWPC 的 PCK/WASM：

```powershell
git clone https://github.com/Caritusy/CoffeeBean.git
cd CoffeeBean
```

本地维护者已经持有游戏运行文件时，可以生成与 GitHub Release 相同结构的 ZIP：

```powershell
./tools/build-release.ps1
```

生成结果位于 `dist/`。打包脚本会检查三个 PCK 和 `index.wasm` 是否齐全，不会把历史中间构建
放进发布包。

## 浏览器插件（可选）

IWPC 工作台本身已经把 CoffeeBean 逻辑直接载入页面，不安装插件也能制作 TAS。如果要把
CoffeeBean 用在其他网页游戏上：

1. 打开 `chrome://extensions` 或 `edge://extensions`。
2. 开启开发者模式。
3. 点击 **加载已解压的扩展程序**。
4. 选择本仓库根目录。

## 参考资料

- [亚当重锤 RNG 权重速查表](game/iwpc/ADAM_RNG_WEIGHTS.md)
- [IWPC 运行包说明](game/iwpc/README.md)
- CoffeeBean 基于 [Instant Coffee](https://github.com/cgadski/instant-coffee) 继续开发。

## 游戏资源说明

仓库包含用于 TAS 研究和复现的 IWPC Web 导出文件。游戏、美术、音乐及相关资源的权利归各自
权利人所有；CoffeeBean 不对这些资源重新授权。
