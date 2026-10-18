# RPlay Video Downloader

一个用于下载 `rplay.live` VOD/回放视频的 Chrome、Edge 浏览器扩展。

![RPlay Video Downloader 界面预览](screenshot/1.png)
![RPlay Video Downloader 界面预览](screenshot/2.png)

## 功能

- 自动检测 RPlay 页面中的视频。
- 刷新页面或切换视频时清空当前标签页的嗅探记录，不中断已开始的后台下载。
- 识别 RPlay API 和 CDN（包括 `pb3.rplay.live`）上的 HLS 主清单，支持 URL 编码的 `s3key`。
- 对单独的 CMAF 视频轨、DASH 清单和 DRM / SAMPLE-AES 受保护媒体显示具体状态。
- 未关联清单的 CMAF 请求在当前页面合并为一条观察记录，不为每个分段新增卡片或弹出播放页通知；保留精确请求地址供清单关联，同一来源的页面通知去重。
- 显示可用分辨率和码率，按需选择画质。
- 支持 DASH 点播：解析 `BaseURL` / `SegmentBase` 完整轨道，以及 `SegmentTemplate` + `SegmentTimeline` 初始化段和编号分片（含 `$Number%09d$`）。按继承的时间刻度处理音视频各自的时间线，自动配对音频并保存为 MP4。Widevine CENC / CBCS 分片通过现有软件 CDM 授权并解密。
- 自定义保存位置与命名：可设置默认保存文件夹，并用类似 yt-dlp 的输出模板自定义目录与文件名，或切换为每次询问保存位置。
- 可选生成 Emby / Jellyfin 元数据：随视频保存 NFO（电影或剧集结构）以及 poster / fanart / thumb 图片。

## 保存与命名

在扩展的「选项」页面设置：

- **默认保存文件夹**：浏览器「下载目录」下的相对子目录（留空为根目录）。受浏览器 API 限制，不能填写盘符或绝对路径；若开启“每次询问保存位置”，则每次下载时由浏览器弹出另存为对话框。
- **自定义保存目录**：在选项页点击「选择文件夹」选中任意磁盘目录（可跨盘）后，视频与 NFO / 图片会由扩展直接写入该目录，不再经过浏览器下载。该功能基于 File System Access，需要浏览器授权，重启后如权限失效需重新选择；未选择或未授权时自动回退到默认保存文件夹。
- **输出模板**：决定子目录和文件名，支持常用 yt-dlp 语法：
  - `%(field)s` 字段值，缺失时为空；`%(field|默认值)s` 指定默认值。
  - `%(date>%Y-%m-%d)s` 按格式输出日期；`%(a,b|默认)s` 取第一个非空字段。
  - `%(title).100B` 按 UTF-8 字节截断，`%(title).100s` 按字符截断。
  - 可用字段：`title`、`id`、`channel`、`channel_id`、`upload_date`、`release_date`、`resolution`、`width`、`height`、`duration`、`ext`。

示例：

```
%(channel)s [%(channel_id|Unknown_id)s]/Season %(release_date>%Y,upload_date>%Y|Unknown)s/S%(release_date>%Y,upload_date>%Y)sE%(release_date>%m%d,upload_date>%m%d)s - %(title).100B [%(id)s].%(ext)s
```

## Emby 元数据

开启后会在视频同目录生成：

- `<视频名>.nfo`（剧集为 `episodedetails`，电影为 `movie`），剧集模式还会在系列目录生成 `tvshow.nfo`、在季目录生成 `season.nfo`。
- `<视频名>-poster.jpg`、`<视频名>-fanart.jpg`、`<视频名>-thumb.jpg`。

其中的频道、简介、上映日期与图片地址来自视频页的 Open Graph / JSON-LD / DOM 抓取；抓取不到的字段或图片会被跳过，不保证对所有页面都完整。

## 安装

### 1. 下载并解压

点击 GitHub 页面右上角的 **Code → Download ZIP**，下载后将 ZIP 完整解压到一个固定目录。

不要直接在压缩包内打开或加载扩展；以后也不要随意删除这个解压目录。

### 2. 加载扩展

1. 打开浏览器扩展管理页：
   - Chrome：`chrome://extensions/`
   - Edge：`edge://extensions/`
2. 开启右上角的“开发者模式”。
3. 点击“加载已解压的扩展程序”。
4. 选择刚刚解压的项目根目录，也就是包含 `manifest.json` 的目录。

> 应选择项目根目录，不要单独选择 `dist` 目录。

## 使用方法

1. 打开一个 RPlay 视频页面并开始播放。
2. 等待页面提示扩展已检测到视频。
3. 点击浏览器工具栏中的扩展图标。
4. 选择需要的清晰度，然后点击下载。
5. 下载完成后，浏览器会询问或自动保存文件，具体取决于浏览器的下载设置。

如果扩展图标没有显示，可以在浏览器的扩展菜单中将它固定到工具栏。

## 支持的浏览器与视频

- Chrome 116 或更高版本。
- Edge 116 或更高版本。
- Chromium 内核的其他浏览器可能可用，但未保证完全兼容。
- 支持 RPlay 的 VOD/回放 HLS，以及单时段 DASH 点播：完整 MP4/CMAF 轨道，或从零开始的连续 `SegmentTemplate` / `SegmentTimeline` 分段（独立初始化文件、有限重复次数）。音频和视频可以使用不同时间刻度、不同分段时长。动态清单、多时段、`SegmentList`、时间线间隙/重叠和非零时间偏移暂不支持。
- MP4 主要支持 H.264 + AAC 视频。
- 传统 MPEG-TS 视频可在符合条件时自动回退保存为 `.ts`。


## 隐私

- 扩展不会加载远程脚本、远程模块或远程字体。
- 联网请求用于 RPlay 的视频清单、媒体分片、AES-128 密钥和播放器的 EZDRM 许可证接口；Widevine 授权、许可证处理和解密均在插件中进行。
- 视频地址和密钥信息不会发送到第三方统计或分析服务。
- 下载文件由浏览器保存到用户选择的本地位置。

## 免责声明

本扩展仅供学习交流使用。下载内容前请确保你拥有相应权利，并遵守服务条款及当地法律。
