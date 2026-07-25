import { Router } from 'express'
import { authRouter } from './modules/auth/auth.routes.js'
import { employeesRouter } from './modules/employees/employees.routes.js'
import { servicesRouter } from './modules/services/services.routes.js'
import { customersRouter } from './modules/customers/customers.routes.js'
import { ordersRouter } from './modules/orders/orders.routes.js'
import { outletsRouter } from './modules/outlets/outlets.routes.js'
import { machinesRouter } from './modules/machines/machines.routes.js'
import { adjustmentsRouter } from './modules/adjustments/adjustments.routes.js'

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
