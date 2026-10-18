import { Base64 } from 'js-base64'

vi.mock('../AnyTLSForm', () => ({ AnyTLSForm: () => null }))
vi.mock('../Hysteria2Form', () => ({ Hysteria2Form: () => null }))
vi.mock('../JuicityForm', () => ({ JuicityForm: () => null }))
vi.mock('../SSForm', () => ({ SSForm: () => null }))
vi.mock('../SSRForm', () => ({ SSRForm: () => null }))
vi.mock('../TrojanForm', () => ({ TrojanForm: () => null }))
vi.mock('../TuicForm', () => ({ TuicForm: () => null }))
vi.mock('../V2rayForm', () => ({ V2rayForm: () => null }))

beforeAll(() => {
  vi.stubGlobal('location', { protocol: 'http:', hostname: 'localhost' })
})

afterAll(() => {
  vi.unstubAllGlobals()
})

it.each([
  { net: 'tcp', type: 'http', path: '/x', expected: { type: 'http', path: '/x' } },
  { net: 'grpc', type: 'none', path: 'svc', expected: { path: 'svc' } },
  { net: 'kcp', type: 'srtp', path: '', expected: { type: 'srtp' } },
  { net: 'ws', type: 'http', path: '/x', expected: { type: '' } },
] as const)('preserves supported vmess fields for $net', async ({ net, type, path, expected }) => {
  // Constants read location during module initialization.
  const { v2rayProtocol } = await import('./complex')
  const link = v2rayProtocol.generateLink({ ...v2rayProtocol.defaultValues, net, type, path })

  expect(JSON.parse(Base64.decode(link.slice('vmess://'.length)))).toMatchObject(expected)
})

it.each(['none', 'xtls-rprx-vision', 'xtls-rprx-vision-udp443'] as const)(
  'serializes the VLESS flow choice %s for dae',
  async (flow) => {
    const { v2rayProtocol } = await import('./complex')
    const link = v2rayProtocol.generateLink({
      ...v2rayProtocol.defaultValues,
      protocol: 'vless',
      flow,
      add: '192.0.2.20',
      port: 443,
      id: '33333333-3333-4333-8333-000000000001',
    })
    expect(new URL(link).searchParams.get('flow')).toBe(flow === 'none' ? null : flow)
  },
)
