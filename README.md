# Claude Chat Viewer

🎯 **Claude Chat Viewer** 是一个直观美观的本地 Web 工具，用于解析并浏览 Anthropic Claude 导出的聊天 JSON 文件。支持多会话浏览、高亮搜索、多选导出、图片插入等增强功能。

---

## 📦 功能特性

- ✅ **导入 JSON 文件**：支持 Claude 导出的单会话或多会话 JSON 文件（支持拖拽与点击上传）。
- 🔍 **全文搜索**：支持按对话名称和内容搜索，包含关键词高亮、结果计数与跳转导航。
- 💬 **多会话支持**：自动按更新时间排序，侧边栏显示所有会话名称并可点击展开。
- 🖼 **图片插入**：支持为消息气泡手动插入本地或网络图片。
- 📁 **导出功能**：
  - 导出当前会话为 JSON 文件
  - 多选导出多个会话为整包 JSON（会话列表中使用复选框）
- ✂️ **多选消息功能**：支持双击气泡进入选择模式，可批量复制、导出为 Markdown、删除。
- 🎨 **响应式 UI**：适配桌面与移动端，具备毛玻璃背景、暗色遮罩、浮动按钮等现代化交互体验。

---

## 📂 项目结构

| 文件名       | 功能说明                                 |
|--------------|------------------------------------------|
| `index.html` | 页面结构定义，包含上传区、聊天面板、会话列表等 |
| `style.css`  | 全局样式，覆盖布局、配色、动画、响应式适配等     |
| `script.js`  | 主交互逻辑，处理文件解析、聊天渲染、搜索、多选等功能 |

---

## 🚀 使用方法

1. **打开页面：**

   将整个项目文件夹放到本地，通过浏览器打开 `index.html` 即可使用。

2. **上传 JSON 文件：**

   - 拖拽 Claude 导出的 JSON 文件到上传区域，或点击上传框选择文件。
   - 支持一次性上传单个或多个会话的 JSON 文件。

3. **浏览与操作：**

   - 点击左侧会话列表，展开聊天记录。
   - 使用搜索框输入关键词，按回车或点击搜索按钮定位内容。
   - 双击任意消息气泡进入多选模式，批量复制 / 导出 / 删除。

4. **导出：**

   - “导出当前会话”按钮用于导出当前聊天记录。
   - “导出整包”用于批量导出选中的多个会话。

---

## 📁 支持的 JSON 格式

支持 Claude 导出的以下两种格式：

- 单个会话对象 `{ name, chat_messages, uuid, ... }`
- 多个会话的数组 `[ { name, chat_messages, ... }, ... ]`

---

## 🛠 技术栈

- HTML5 + CSS3 + JavaScript (Vanilla)
- UI 框架：无依赖
- 第三方库：
  - [`marked`](https://marked.js.org/)：用于 Markdown 渲染聊天内容
  - [`dayjs`](https://day.js.org/)：处理时间格式
  - [`oboe`](https://github.com/jimhigson/oboe.js/)：支持流式解析大型 JSON 文件

---

## 📱 响应式设计

- 自动适配移动端，包含浮动菜单按钮、顶部栏、会话折叠展开等交互。
- 移动端默认启用毛玻璃背景并支持触控手势（如长按显示时间等）。

---

## 📤 导出说明

- 若会话中包含本地上传（base64）图片，则禁用批量导出。
- 支持导出为 JSON（结构保留）、Markdown（内容整理）等格式。

---

## 📜 License

MIT License © 2025
