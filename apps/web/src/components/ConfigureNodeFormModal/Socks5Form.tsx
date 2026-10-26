import type { GenerateURLParams } from '@daeuniverse/dae-node-parser'
import type { z } from 'zod'
import type { NodeFormProps } from './types'
import { generateURL, parseSocks5Url } from '@daeuniverse/dae-node-parser'
import { createPortal } from 'react-dom'

import { FormActions } from '~/components/FormActions'
import { Input } from '~/components/ui/input'
import { NumberInput } from '~/components/ui/number-input'
import { DEFAULT_SOCKS5_FORM_VALUES, socks5Schema } from '~/constants'
import { useNodeForm } from '~/hooks'

export type Socks5FormValues = z.infer<typeof socks5Schema>

function generateSocks5Link(data: Socks5FormValues): string {
  const generateURLParams: GenerateURLParams = {
    protocol: 'socks5',
    host: data.host,
    port: data.port,
    hash: data.name,
  }

  if (data.username && data.password) {
    Object.assign(generateURLParams, {
      username: data.username,
      password: data.password,
    })
  }

  return generateURL(generateURLParams)
}

export function Socks5Form({ onLinkGeneration, initialValues, actionsPortal }: NodeFormProps<Socks5FormValues>) {
  const { formValues, setValue, handleSubmit, onSubmit, submit, resetForm, isDirty, isValid, errors, t: translate } = useNodeForm({
    schema: socks5Schema,
    defaultValues: DEFAULT_SOCKS5_FORM_VALUES,
    initialValues,
    onLinkGeneration,
    generateLink: generateSocks5Link,
    parseLink: parseSocks5Url,
  })

  // t() 的键类型推导在本文件会超过 TS 的实例化深度上限（TS2589），窄化成
  // (key) => string 即可；键名仍受语言包约束，由 i18n 测试兜底。
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
        value={formValues.host}
        onChange={(e) => setValue('host', e.target.value)}
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
        label={t('configureNode.username')}
        value={formValues.username}
        onChange={(e) => setValue('username', e.target.value)}
      />

      <Input
        label={t('configureNode.password')}
        value={formValues.password}
        onChange={(e) => setValue('password', e.target.value)}
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
