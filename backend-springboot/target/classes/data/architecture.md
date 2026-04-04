# 系统架构说明

## 总体说明

当前版本由 5 层组成：

1. 司机端微信小程序
2. 用户端微信小程序
3. Spring Boot 后端服务
4. 微信登录换会话层
5. MySQL 数据存储层

## 司机端调用链

司机打开小程序 -> 调用 `wx.login` 获取 `code` -> 请求后端 `/api/driver/wx-login` -> 后端调用微信 `jscode2session` 或本地 mock 登录 -> 绑定 `driver_account` -> 生成 `driver_login_session` -> 返回 `loginToken` -> 司机端调用发车/收车/上传位置接口时带上 `X-Driver-Token`

## 用户端调用链

用户打开首页 -> 拉取线路与站点 -> 调用 `/api/user/overview` 获取当前线路视图 -> 接收 WebSocket 推送 -> 实时刷新地图与车辆列表

## 后端内部模块

### WechatAuthService

负责把小程序 `code` 换成 `openid`。在演示环境中可以切换到 mock 模式。

### DriverAccountService

负责司机与微信 openid、车辆、线路的绑定。

### DriverSessionService

负责生成和校验 `loginToken`。

### RouteService

负责线路和站点读取。

### VehicleLocationService

负责：
- 车辆发车与收车状态
- 保存最新位置
- 计算最近站点
- 估算到站时间
- 写入历史轨迹

### DriverController

司机端接口入口，负责登录态校验和司机业务调用。

### UserController

用户端查询接口入口。

### VehicleWebSocketHandler

把车辆最新状态实时广播给用户端。

## 当前版本与上版的差异

1. 司机端从“手填即登录”升级成“微信 code 登录 + 司机绑定”
2. 增加 `driver_login_session` 表保存业务登录态
3. 司机端后续接口不再依赖手工传司机姓名和车辆编号
4. 支持本地 mock 登录，方便你在没有真实小程序密钥时先跑通 Demo
