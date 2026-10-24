# AX3000T 适配依据

目标设备为 AX3000T，硬件 RD03，中国区，固件 1.0.84。识别读取当前设备的公开初始化信息；认证和管理字段比对了同版本原厂 LuCI 模板。没有登录用户的真实路由器，也没有对其执行写操作。

- [官方固件来源](https://cdn.cnbj1.fds.api.mi-img.com/xiaoqiang/rom/rd03/miwifi_rd03_firmware_f85f9_1.0.84.bin)，SHA256：`7045A603B8235FECD27285FFB80CBDD525DAD70037CCE7DF398CE6B54754DBC3`。
- [官方产品信息](https://www.mi.com/tw/product/xiaomi-router-ax3000t/)。
- [微软 Wi-Fi 位置授权说明](https://learn.microsoft.com/en-us/windows/win32/nativewifi/wi-fi-access-location-changes)。
- [IEEE 厂商分配数据](https://standards-oui.ieee.org/)：MA-L、MA-M、MA-S，采集于 2026-10-24。

认证读取当前登录页的盐与设备标识，按初始化信息选 SHA256 或 SHA1 双层摘要，以表单提交。只有业务 `code=0` 视为成功；HTTP 200 中的业务 401 仍视为未认证。盐、密码、nonce 和 token 不写入报告。

无线读取使用 `xqnetwork/wifi_detail_all`。信道和带宽枚举来自认证后的无线设置页。写入使用 `xqnetwork/set_all_wifi`，保留两个频段的状态、SSID、密码、加密、隐藏、信道、频宽和强度。双频设备不发送虚构第三频段。`status` 决定开关，不以通用模板中的 `enabled` 代替。

设备限速使用 `misystem/qos_limits` 的表单 `data` JSON；上网权限使用 `xqsystem/set_mac_filter`。静态绑定、DHCP 与端口转发各使用固定的已知字段。端口转发先以只读页面或规则响应确认命名空间，不向多个路径轮流试写。

记住的管理密码和无线修改前备份使用 DPAPI。前端只收到密码是否可保留的状态。写入不自动重试；连接中断时提示回读，不能把超时显示为修改成功。

原厂模板是协议依据，不构成厂商对第三方 API 的兼容承诺。界面区分“路由器接受请求”和“回读已确认”。
