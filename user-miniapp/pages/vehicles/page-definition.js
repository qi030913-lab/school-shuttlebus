const socketModule = require('../../common/socket')
const pageHelpers = require('../../common/pageHelpers')
const overviewModule = require('../../common/vehiclesOverview')
const presentationModule = require('../../common/vehiclesPresentation')

const POLL_INTERVAL_MS = 15000
const SOCKET_RETRY_BASE_MS = 2000
const SOCKET_RETRY_MAX_MS = 15000

const pageDefinition = {
  data: {
    routeId: '',
    routeName: '',
    serviceTime: '',
    vehicleId: '',
    detailMode: false,
    vehicles: [],
    refreshing: false,
    socketStatusText: '实时连接中',
    socketStatusClass: 'status-connecting',
    lastUpdateText: '--:--:--',
    pageTitle: '车辆明细',
    pageSubtitle: '实时展示司机、状态、速度、经纬度与更新时间',
    emptyText: '当前线路暂时没有在线摆渡车'
  },

  async onLoad(options) {
    this.socketTask = null
    this.socketReconnectTimer = null
    this.socketClosedByUser = false
    this.socketRetryCount = 0
    this.socketRetryBaseMs = SOCKET_RETRY_BASE_MS
    this.socketRetryMaxMs = SOCKET_RETRY_MAX_MS
    this.vehicleMotionMap = {}

    const routeId = decodeURIComponent(options.routeId || '')
    const routeName = decodeURIComponent(options.routeName || '')
    const serviceTime = decodeURIComponent(options.serviceTime || '')
    const vehicleId = decodeURIComponent(options.vehicleId || '')
    const detailMode = !!vehicleId

    this.setData({
      routeId,
      routeName,
      serviceTime,
      vehicleId,
      detailMode,
      pageTitle: detailMode ? '车辆详情' : '车辆明细',
      pageSubtitle: detailMode
        ? '查看当前车辆的实时状态、速度、经纬度与更新时间'
        : '实时展示司机、状态、速度、经纬度与更新时间',
      emptyText: detailMode ? '当前未获取到该车辆信息' : '当前线路暂时没有在线摆渡车'
    })

    if (detailMode) {
      wx.setNavigationBarTitle({
        title: '车辆详情'
      })
    }

    if (!routeId && !vehicleId) {
      wx.showToast({ title: '缺少车辆信息', icon: 'none' })
      return
    }

    await this.loadOverview(false)
    this.connectSocket()
    this.pollTimer = setInterval(() => {
      this.loadOverview(false)
    }, POLL_INTERVAL_MS)
  },

  onUnload() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
    this.clearSocketReconnectTimer()
    this.socketClosedByUser = true
    if (this.socketTask) {
      this.socketTask.close()
      this.socketTask = null
    }
    this.vehicleMotionMap = {}
  },

  filterSocketVehicles(vehicles) {
    return this.filterVehicles(vehicles)
  },

  handleSocketVehicles(vehicles) {
    this.applyVehicles(vehicles)
  },

  handleSocketParseError() {
  },

  setSocketStatus(status) {
    const statusMap = {
      connecting: {
        text: '实时连接中',
        className: 'status-connecting'
      },
      connected: {
        text: '实时已连接',
        className: 'status-connected'
      },
      reconnecting: {
        text: '正在重连',
        className: 'status-reconnecting'
      },
      disconnected: {
        text: '实时已断开',
        className: 'status-disconnected'
      }
    }

    const current = statusMap[status] || statusMap.disconnected
    this.setData({
      socketStatusText: current.text,
      socketStatusClass: current.className
    })
  }
}

module.exports = Object.assign(
  {},
  pageDefinition,
  socketModule,
  pageHelpers,
  overviewModule,
  presentationModule
)
