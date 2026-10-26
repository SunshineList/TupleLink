import type { z } from 'zod'
import type { NodeFormProps } from './types'
import { parseAnytlsUrl } from '@daeuniverse/dae-node-parser'
import { createPortal } from 'react-dom'

import { FormActions } from '~/components/FormActions'
import { Checkbox } from '~/components/ui/checkbox'
import { Input } from '~/components/ui/input'
import { NumberInput } from '~/components/ui/number-input'
import { anytlsSchema, DEFAULT_ANYTLS_FORM_VALUES } from '~/constants'
import { useNodeForm } from '~/hooks'
import { generateAnytlsLink } from './protocols/complex'

export type AnytlsFormValues = z.infer<typeof anytlsSchema>

export function AnyTLSForm({ onLinkGeneration, initialValues, actionsPortal }: NodeFormProps<AnytlsFormValues>) {
  const { formValues, setValue, handleSubmit, onSubmit, submit, resetForm, isDirty, isValid, errors, t: translate } =
    useNodeForm({
    schema: anytlsSchema,
    defaultValues: DEFAULT_ANYTLS_FORM_VALUES,
    initialValues,
    onLinkGeneration,
    generateLink: generateAnytlsLink,
    parseLink: parseAnytlsUrl,
  })

  // 这个文件里 t() 的键类型推导会超过 TS 的实例化深度上限（TS2589），
  // 窄化成 (key) => string 就不会了；键名仍然受语言包约束，靠测试兜底。
  const t = translate as unknown as (key: string) => string

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
      <Input label="Auth" withAsterisk value={formValues.auth} onChange={(e) => setValue('auth', e.target.value)} />
      <Input label="SNI" value={formValues.sni} onChange={(e) => setValue('sni', e.target.value)} />
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
