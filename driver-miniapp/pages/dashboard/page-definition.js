const { request } = require('../../common/request')
const { tencentMap } = require('../../config')
const { createDashboardLocationModule } = require('../../common/location')
const { createDashboardTestRouteModule } = require('../../common/testRoute')
const { createDashboardRuntimeModule } = require('../../common/dashboardRuntime')
const { createDashboardActionsModule } = require('../../common/dashboardActions')

const UPLOAD_THROTTLE_MS = 1000
// 测试数据1 北门到双体 线下演示
const TEST_START_LATITUDE = 36.244498
const TEST_START_LONGITUDE = 117.287531
const TEST_TARGET_LATITUDE = 36.241457
const TEST_TARGET_LONGITUDE = 117.291047

// 测试数据2 南门到育英 线上演示
// const TEST_START_LATITUDE = 36.239910
// const TEST_START_LONGITUDE = 117.287131
// const TEST_TARGET_LATITUDE = 36.239671
// const TEST_TARGET_LONGITUDE = 117.292507

const TEST_LOCATION_INTERVAL_MS = 1000
const TEST_ROUTE_SAMPLE_DISTANCE_METERS = 15
const TEST_ROUTE_DEFAULT_SPEED = Number(
  (TEST_ROUTE_SAMPLE_DISTANCE_METERS * 1000 / TEST_LOCATION_INTERVAL_MS).toFixed(2)
)
const TEST_MANUAL_ROUTE_POINTS = [
  [36.244498, 117.287531],
  [36.244512, 117.287902],
  [36.24452, 117.288318],
  [36.244498, 117.288796],
  [36.244255, 117.289248],
  [36.243846, 117.28964],
  [36.243343, 117.289987],
  [36.242787, 117.29033],
  [36.242214, 117.290618],
  [36.24176, 117.290874],
  [36.241457, 117.291047]
]
const TENCENT_MAP_DIRECTION_KEY = tencentMap.directionKey
const TENCENT_MAP_DIRECTION_MODES = ['driving', 'walking']

const TRIP_STATUS_CODE_IDLE = 'IDLE'
const TRIP_STATUS_CODE_RUNNING = 'RUNNING'
const TRIP_STATUS_CODE_STOPPED = 'STOPPED'

const TRIP_STATUS_IDLE = '未发车'
const TRIP_STATUS_RUNNING = '运行中'
const TRIP_STATUS_STOPPED = '已结束'

const MESSAGE_LOGIN_EXPIRED = '登录态失效，请重新登录'
const MESSAGE_NEED_LOCATION_PERMISSION = '需要定位权限'
const MESSAGE_NEED_LOCATION_PERMISSION_DESC = '司机端需要获取定位后才能上传车辆位置，请先开启定位权限。'
const MESSAGE_GO_ENABLE = '去开启'
const MESSAGE_CANCEL = '取消'
const MESSAGE_OPEN_SETTING_FAILED = '无法打开设置页'
const MESSAGE_CHECK_PERMISSION_FAILED = '定位权限检查失败'
const MESSAGE_LOCATION_PERMISSION_MISSING = '未开启定位权限'
const MESSAGE_ENABLE_GPS = '请打开手机定位服务'
const MESSAGE_START_TRACKING_FAILED = '开启持续定位失败'
const MESSAGE_FIRST_LOCATION_FAILED = '首次定位失败'
const MESSAGE_TRIP_STARTED = '已发车'
const MESSAGE_TRIP_STARTED_CHECK_LOCATION = '已发车，请检查定位'
const MESSAGE_TRIP_START_FAILED = '发车失败'
const MESSAGE_TRIP_STOPPED = '已结束发车'
const MESSAGE_TRIP_STOP_FAILED = '结束发车失败'
const MESSAGE_START_TRIP_FIRST = '请先开始发车'
const MESSAGE_LOCATION_FAILED = '定位失败，请重试'
const MESSAGE_TEST_STOPPED = '测试已停止'
const MESSAGE_TEST_ROUTE_PREPARING = '测试路线准备中'
const MESSAGE_PLANNING_ROUTE = '规划路线中'
const MESSAGE_BUILD_ROUTE_FAILED = '测试路线生成失败'
const MESSAGE_REACHED_TARGET = '已到达测试终点'
const MESSAGE_TEST_START_DEFAULT = '测试已开始'
const MESSAGE_TEST_START_DRIVING = '驾车路线测试中'
const MESSAGE_TEST_START_WALKING = '步行路线测试中'
const MESSAGE_TEST_START_MANUAL = '预设路线测试中'
const MESSAGE_TEST_START_FALLBACK = '直线回退测试中'
const MESSAGE_UPLOAD_SUCCESS = '上报成功'
const MESSAGE_UPLOAD_FAILED = '位置上报失败'

const pageDefinition = {
  data: {
    driverName: '',
    vehicleId: '',
    routeId: '',
    routeName: '',
    tripStatusCode: TRIP_STATUS_CODE_IDLE,
    tripStatus: TRIP_STATUS_IDLE,
    latitude: '--',
    longitude: '--',
    speed: '--',
    autoUpload: false,
    mockMode: false,
    testing: false,
    labels: {
      panelTitle: '司机面板',
      driver: '司机：',
      vehicle: '车辆：',
      route: '线路：',
      loginMode: '登录模式：',
      mockMode: 'Mock 模式',
      realLogin: '微信真实登录',
      status: '状态：',
      latitude: '纬度：',
      longitude: '经度：',
      speed: '速度：',
      startTrip: '开始发车',
      uploadOnce: '上传一次位置',
      startAutoUpload: '开启自动上传',
      stopAutoUpload: '停止自动上传',
      startTestRoute: '开始测试路线',
      stopTest: '停止测试',
      stopTrip: '结束发车',
      logout: '退出登录'
    }
  }
}

const runtimeModule = createDashboardRuntimeModule({
  request,
  tripStatusIdleCode: TRIP_STATUS_CODE_IDLE,
  tripStatusRunningCode: TRIP_STATUS_CODE_RUNNING,
  tripStatusStoppedCode: TRIP_STATUS_CODE_STOPPED,
  tripStatusIdle: TRIP_STATUS_IDLE,
  tripStatusRunning: TRIP_STATUS_RUNNING,
  tripStatusStopped: TRIP_STATUS_STOPPED,
  messageLoginExpired: MESSAGE_LOGIN_EXPIRED
})

const locationModule = createDashboardLocationModule({
  needLocationPermission: MESSAGE_NEED_LOCATION_PERMISSION,
  needLocationPermissionDesc: MESSAGE_NEED_LOCATION_PERMISSION_DESC,
  goEnable: MESSAGE_GO_ENABLE,
  cancel: MESSAGE_CANCEL,
  openSettingFailed: MESSAGE_OPEN_SETTING_FAILED,
  checkPermissionFailed: MESSAGE_CHECK_PERMISSION_FAILED,
  locationPermissionMissing: MESSAGE_LOCATION_PERMISSION_MISSING,
  enableGps: MESSAGE_ENABLE_GPS,
  startTrackingFailed: MESSAGE_START_TRACKING_FAILED
})

const testRouteModule = createDashboardTestRouteModule({
  testStartLatitude: TEST_START_LATITUDE,
  testStartLongitude: TEST_START_LONGITUDE,
  testTargetLatitude: TEST_TARGET_LATITUDE,
  testTargetLongitude: TEST_TARGET_LONGITUDE,
  testLocationIntervalMs: TEST_LOCATION_INTERVAL_MS,
  testRouteDefaultSpeed: TEST_ROUTE_DEFAULT_SPEED,
  testRouteSampleDistanceMeters: TEST_ROUTE_SAMPLE_DISTANCE_METERS,
  testManualRoutePoints: TEST_MANUAL_ROUTE_POINTS,
  tencentMapDirectionKey: TENCENT_MAP_DIRECTION_KEY,
  tencentMapDirectionModes: TENCENT_MAP_DIRECTION_MODES
})

const actionsModule = createDashboardActionsModule({
  request,
  uploadThrottleMs: UPLOAD_THROTTLE_MS,
  testLocationIntervalMs: TEST_LOCATION_INTERVAL_MS,
  tripStatusRunningCode: TRIP_STATUS_CODE_RUNNING,
  tripStatusRunning: TRIP_STATUS_RUNNING,
  tripStatusStopped: TRIP_STATUS_STOPPED,
  messageFirstLocationFailed: MESSAGE_FIRST_LOCATION_FAILED,
  messageTripStarted: MESSAGE_TRIP_STARTED,
  messageTripStartedCheckLocation: MESSAGE_TRIP_STARTED_CHECK_LOCATION,
  messageTripStartFailed: MESSAGE_TRIP_START_FAILED,
  messageTripStopped: MESSAGE_TRIP_STOPPED,
  messageTripStopFailed: MESSAGE_TRIP_STOP_FAILED,
  messageStartTripFirst: MESSAGE_START_TRIP_FIRST,
  messageLocationPermissionMissing: MESSAGE_LOCATION_PERMISSION_MISSING,
  messageEnableGps: MESSAGE_ENABLE_GPS,
  messageLocationFailed: MESSAGE_LOCATION_FAILED,
  messageTestStopped: MESSAGE_TEST_STOPPED,
  messageTestRoutePreparing: MESSAGE_TEST_ROUTE_PREPARING,
  messagePlanningRoute: MESSAGE_PLANNING_ROUTE,
  messageBuildRouteFailed: MESSAGE_BUILD_ROUTE_FAILED,
  messageReachedTarget: MESSAGE_REACHED_TARGET,
  messageTestStartDefault: MESSAGE_TEST_START_DEFAULT,
  messageTestStartDriving: MESSAGE_TEST_START_DRIVING,
  messageTestStartWalking: MESSAGE_TEST_START_WALKING,
  messageTestStartManual: MESSAGE_TEST_START_MANUAL,
  messageTestStartFallback: MESSAGE_TEST_START_FALLBACK,
  messageUploadSuccess: MESSAGE_UPLOAD_SUCCESS,
  messageUploadFailed: MESSAGE_UPLOAD_FAILED
})

module.exports = Object.assign(
  {},
  pageDefinition,
  runtimeModule,
  locationModule,
  testRouteModule,
  actionsModule
)
