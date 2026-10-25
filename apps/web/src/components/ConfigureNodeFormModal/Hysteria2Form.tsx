import type { z } from 'zod'
import type { NodeFormProps } from './types'
import { generateHysteria2URL, parseHysteria2Url } from '@daeuniverse/dae-node-parser'
import { createPortal } from 'react-dom'

import { FormActions } from '~/components/FormActions'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { NumberInput } from '~/components/ui/number-input'
import { DEFAULT_HYSTERIA2_FORM_VALUES, hysteria2Schema } from '~/constants'
import { useNodeForm } from '~/hooks'
import { portsIssue } from './ports'

export type Hysteria2FormValues = z.infer<typeof hysteria2Schema>

function generateHysteria2Link(data: Hysteria2FormValues): string {
  /* hysteria2://[auth@]hostname[:port]/?[key=value]&[key=value]... */
  const query = {
    obfs: data.obfs,
    'obfs-password': data.obfsPassword,
    sni: data.sni,
    ports: data.ports || '',
    insecure: data.allowInsecure ? 1 : 0,
    pinSHA256: data.pinSHA256,
  }

  return generateHysteria2URL({
    protocol: 'hysteria2',
    auth: data.auth,
    host: data.server,
    port: data.port,
    hash: data.name,
    params: query,
  })
}

export function Hysteria2Form({ onLinkGeneration, initialValues, actionsPortal }: NodeFormProps<Hysteria2FormValues>) {
  const { formValues, setValue, handleSubmit, onSubmit, submit, resetForm, isDirty, isValid, errors, t } = useNodeForm({
    schema: hysteria2Schema,
    defaultValues: DEFAULT_HYSTERIA2_FORM_VALUES,
    initialValues,
    onLinkGeneration,
    generateLink: generateHysteria2Link,
    parseLink: parseHysteria2Url,
  })

  // 端口跳跃是这一页最容易填错的一格：逗号必须是半角、区间用减号、每段 1-65535。
  // 这里只做提示，不拦住保存——后端仍按自己的规则解析，用户可能有意写别的形式。
  const portsProblem = portsIssue(formValues.ports || '')

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-2">
      <Input
        label={t('configureNode.name')}
        value={formValues.name}
        onChange={(e) => setValue('name', e.target.value)}
      />
      <Input
        label={t('configureNode.host')}
        withAsterisk
        value={formValues.server}
        onChange={(e) => setValue('server', e.target.value)}
      />
      <NumberInput
        label={t('configureNode.port')}
        withAsterisk
        min={0}
        max={65535}
        value={formValues.port}
        onChange={(val) => setValue('port', Number(val))}
      />
      <Input
        label={t('configureNode.portHopping')}
        placeholder="10000-20000,443"
        value={formValues.ports || ''}
        onChange={(e) => setValue('ports', e.target.value)}
        description={portsProblem ? t('configureNode.portHoppingInvalid') : t('configureNode.portHoppingHint')}
        aria-invalid={portsProblem ? true : undefined}
      />
      <Input label={t('configureNode.auth')} withAsterisk value={formValues.auth} onChange={(e) => setValue('auth', e.target.value)} />
      <Input
        label={t('configureNode.obfs')}
        placeholder="salamander"
        value={formValues.obfs}
        onChange={(e) => setValue('obfs', e.target.value)}
      />
      <Input
        label={t('configureNode.obfsPassword')}
        type="password"
        value={formValues.obfsPassword}
        onChange={(e) => setValue('obfsPassword', e.target.value)}
      />
      <Input label={t('configureNode.sni')} value={formValues.sni} onChange={(e) => setValue('sni', e.target.value)} />
      <Input
        label={t('configureNode.pinSHA256')}
        value={formValues.pinSHA256}
        onChange={(e) => setValue('pinSHA256', e.target.value)}
      />
      <Checkbox
        label={t('allowInsecure')}
        checked={formValues.allowInsecure}
        onCheckedChange={(checked) => setValue('allowInsecure', !!checked)}
      />
      {actionsPortal ? (
        createPortal(
          <FormActions
            reset={resetForm}
            onSubmit={submit}
            isDirty={isDirty}
            isValid={isValid}
            errors={errors}
            requireDirty={false}
          />,
          actionsPortal,
        )
      ) : (
        <FormActions reset={resetForm} isDirty={isDirty} isValid={isValid} errors={errors} requireDirty={false} />
      )}
    </form>
  )
}
