const requestModule = require('./common/request')
const vehicleStateModule = require('./common/vehicleState')

module.exports = {
  ...requestModule,
  ...vehicleStateModule
}
