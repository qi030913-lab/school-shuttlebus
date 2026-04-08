const { WS_URL } = require('./request')

module.exports = {
  clearSocketReconnectTimer() {
    if (this.socketReconnectTimer) {
      clearTimeout(this.socketReconnectTimer)
      this.socketReconnectTimer = null
    }
  },

  scheduleSocketReconnect() {
    const retryBaseMs = Number(this.socketRetryBaseMs) || 2000
    const retryMaxMs = Number(this.socketRetryMaxMs) || 15000

    if (this.socketClosedByUser || this.socketReconnectTimer) {
      return
    }

    this.socketRetryCount += 1
    this.setSocketStatus('reconnecting')

    const delay = Math.min(retryMaxMs, retryBaseMs * this.socketRetryCount)
    this.socketReconnectTimer = setTimeout(() => {
      this.socketReconnectTimer = null
      if (!this.socketClosedByUser) {
        this.connectSocket()
      }
    }, delay)
  },

  connectSocket() {
    this.clearSocketReconnectTimer()
    this.setSocketStatus(this.socketRetryCount > 0 ? 'reconnecting' : 'connecting')

    const socketTask = wx.connectSocket({ url: WS_URL })
    this.socketTask = socketTask

    socketTask.onOpen(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.socketRetryCount = 0
      this.setSocketStatus('connected')
    })

    socketTask.onMessage((res) => {
      if (this.socketTask !== socketTask) {
        return
      }

      try {
        const body = JSON.parse(res.data)
        const vehicles = Array.isArray(body && body.data) ? body.data : []
        const filtered = typeof this.filterSocketVehicles === 'function'
          ? this.filterSocketVehicles(vehicles)
          : vehicles

        if (typeof this.handleSocketVehicles === 'function') {
          this.handleSocketVehicles(filtered, res)
        }
      } catch (error) {
        if (typeof this.handleSocketParseError === 'function') {
          this.handleSocketParseError(error, res)
          return
        }
        console.log('socket parse skip', error)
      }
    })

    socketTask.onError(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.setSocketStatus('reconnecting')
    })

    socketTask.onClose(() => {
      if (this.socketTask !== socketTask) {
        return
      }
      this.socketTask = null
      if (this.socketClosedByUser) {
        this.setSocketStatus('disconnected')
        return
      }
      this.scheduleSocketReconnect()
    })
  }
}
