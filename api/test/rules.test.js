import test from 'node:test'
import assert from 'node:assert/strict'
import { computeDeadlines, ruleMatches } from '../src/rules.js'

const today = new Date('2026-05-01T00:00:00Z')
const owner = (type, facts) => ({ ownerType:type,ownerId:'owner',label:'測試對象',customerId:'customer',customerName:'測試客戶',facts })
const rule = (method, params = {}, match = {}) => ({ id:'rule',code:'test_rule',name:'測試規則',scope:'company',method,params,match,remindDays:60,active:1 })
const run = (item, target, options = {}) => computeDeadlines({ rules:[item],owners:[target],tracked:new Map(),completions:new Set(),today,...options })

test('yearly fixed date and February 29', () => {
  assert.equal(run(rule('yearly',{month:6,day:30}),owner('company',{}))[0].dueOn,'2026-06-30')
  assert.equal(run(rule('yearly',{month:2,day:29}),owner('company',{}))[0].dueOn,'2027-02-28')
})
test('anniversary February 29 with offset', () => {
  assert.equal(run(rule('anniversary',{offsetDays:42}),owner('company',{incorporatedOn:'2020-02-29'}))[0].dueOn,'2026-04-11')
})
test('anniversary starts after the incorporation year', () => {
  const result = run(rule('anniversary',{offsetDays:42}),owner('company',{incorporatedOn:'2026-03-01'}))
  assert.equal(result[0].dueOn,'2027-04-12')
})
test('inspection mark years 2, 4, 8; inspection year 6 and annually from 10', () => {
  const inspection = { ...rule('inspection',{markYears:[2,4,8],inspectYears:[6],yearlyFrom:10}),scope:'vehicle' }
  for (const [year,detail] of [[2,'免檢'],[4,'免檢'],[6,'上線'],[8,'免檢'],[10,'上線'],[11,'上線']]) {
    assert.match(run(inspection,owner('vehicle',{firstRegisteredOn:`${2026-year}-06-01` }))[0].detail,new RegExp(detail))
  }
})
test('expiry without date is missing', () => assert.equal(run(rule('expiry'),owner('company',{}))[0].level,'missing'))
test('completion advances to next period', () => assert.equal(run(rule('yearly',{month:6,day:30}),owner('company',{}),{completions:new Set(['test_rule:owner:2026'])})[0].period,'2027'))
test('old overdue periods are omitted', () => assert.equal(run(rule('yearly',{month:1,day:1}),owner('company',{}))[0].period,'2027'))
test('array match conditions', () => {
  assert.equal(ruleMatches({match:{jurisdiction:['香港','澳門']}},{jurisdiction:'澳門'}),true)
  assert.equal(ruleMatches({match:{jurisdiction:['香港','澳門']}},{jurisdiction:'內地'}),false)
})
test('company status match condition', () => {
  const statusRule = rule('yearly',{month:12,day:31},{companyStatus:'註銷中'})
  assert.equal(ruleMatches(statusRule,{companyStatus:'註銷中'}),true)
  assert.equal(ruleMatches(statusRule,{companyStatus:'存續'}),false)
})
test('dissolved company has no deadlines', () => {
  const target = owner('company',{status:'已註銷',companyStatus:'已註銷'})
  const tracked = new Map([['company:owner:test_rule',{expires_on:'2026-01-01',notes:''}]])
  assert.deepEqual(computeDeadlines({rules:[rule('expiry')],owners:[target],tracked,completions:new Set(),today}),[])
})
test('periodic rule uses quarterly YYYY-MM periods and official URL', () => {
  const periodic = { ...rule('periodic',{months:[1,4,7,10],officialUrl:'https://www.gsxt.gov.cn/'}), match:{} }
  const result = run(periodic,owner('company',{status:'存續'}))
  assert.equal(result[0].period,'2026-04')
  assert.equal(result[0].officialUrl,'https://www.gsxt.gov.cn/')
})
