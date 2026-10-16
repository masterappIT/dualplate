import { createRouter, createWebHashHistory, type RouteRecordRaw } from 'vue-router'
import { user } from '../api'

const routes: RouteRecordRaw[] = [
  { path: '/', redirect: '/today' },
  { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  { path: '/today', name: 'today', component: () => import('../views/Dashboard.vue') },
  { path: '/customers', name: 'customers', component: () => import('../views/Customers.vue') },
  { path: '/customers/:id', name: 'customer-detail', component: () => import('../views/CustomerDetail.vue') },
  { path: '/plates', name: 'plates', component: () => import('../views/Vehicles.vue') },
  { path: '/plates/:id', name: 'plate-detail', component: () => import('../views/PlateDetail.vue') },
  { path: '/vehicles/:id', name: 'vehicle-detail', component: () => import('../views/VehicleDetail.vue') },
  { path: '/business', name: 'business', component: () => import('../views/Requests.vue') },
  { path: '/requests/new', name: 'new-request', component: () => import('../views/NewRequest.vue') },
  { path: '/requests/:id', name: 'request-detail', component: () => import('../views/RequestDetail.vue') },
  { path: '/rentals', name: 'rentals', component: () => import('../views/Rentals.vue') },
  { path: '/fees', name: 'fees', component: () => import('../views/Fees.vue') },
  { path: '/filings', name: 'filings', component: () => import('../views/Filings.vue') },
  { path: '/reports', name: 'reports', component: () => import('../views/Reports.vue') },
  { path: '/reports/:id', name: 'report-detail', component: () => import('../views/ReportDetail.vue') },
  { path: '/settings/:tab?', name: 'settings', component: () => import('../views/Settings.vue') },
  ...Object.entries({ dashboard: '/today', overview: '/today', companies: '/customers', vehicles: '/plates', requests: '/business', rules: '/settings/rules', sources: '/settings/sources' }).map(([old, path]) => ({ path: `/${old}`, redirect: path })),
  { path: '/:pathMatch(.*)*', redirect: '/today' },
]

export const router = createRouter({ history: createWebHashHistory(), routes })
router.beforeEach(to => {
  if (to.name === 'login') return user() ? String(to.query.redirect || '/today') : true
  if (!user()) return { path: '/login', query: { redirect: to.fullPath } }
})
