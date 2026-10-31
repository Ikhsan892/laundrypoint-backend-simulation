import { Router } from 'express'
import { authRouter } from './modules/auth/auth.routes.js'
import { employeesRouter } from './modules/employees/employees.routes.js'
import { servicesRouter } from './modules/services/services.routes.js'
import { customersRouter } from './modules/customers/customers.routes.js'
import { ordersRouter } from './modules/orders/orders.routes.js'
import { outletsRouter } from './modules/outlets/outlets.routes.js'
import { machinesRouter } from './modules/machines/machines.routes.js'
import { adjustmentsRouter } from './modules/adjustments/adjustments.routes.js'
import { lostFoundRouter } from './modules/lostFound/lostFound.routes.js'
import { damageReportsRouter } from './modules/damageReports/damageReports.routes.js'
import { reportsRouter } from './modules/reports/reports.routes.js'
import { shiftsRouter } from './modules/shifts/shifts.routes.js'
import { washLogsRouter } from './modules/washLogs/washLogs.routes.js'
import { supplyLogsRouter } from './modules/supplyLogs/supplyLogs.routes.js'
import { maintenanceRouter } from './modules/maintenance/maintenance.routes.js'
import { itemSwapsRouter } from './modules/itemSwaps/itemSwaps.routes.js'
import { ironChecksRouter } from './modules/ironChecks/ironChecks.routes.js'

export const apiRouter = Router()

apiRouter.get('/health', (_req, res) => {
  res.json({ status: 'ok', service: 'laundrypoint-backend', time: new Date().toISOString() })
})

apiRouter.use('/auth', authRouter)
apiRouter.use('/outlets', outletsRouter)
apiRouter.use('/employees', employeesRouter)
apiRouter.use('/services', servicesRouter)
apiRouter.use('/customers', customersRouter)
apiRouter.use('/orders', ordersRouter)
apiRouter.use('/machines', machinesRouter)
apiRouter.use('/adjustments', adjustmentsRouter)
apiRouter.use('/lost-found', lostFoundRouter)
apiRouter.use('/damage-reports', damageReportsRouter)
apiRouter.use('/reports', reportsRouter)
apiRouter.use('/shifts', shiftsRouter)
apiRouter.use('/wash-logs', washLogsRouter)
apiRouter.use('/supply-logs', supplyLogsRouter)
apiRouter.use('/maintenance', maintenanceRouter)
apiRouter.use('/item-swaps', itemSwapsRouter)
apiRouter.use('/iron-checks', ironChecksRouter)
