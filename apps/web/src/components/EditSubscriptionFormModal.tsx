import { zodResolver } from '@hookform/resolvers/zod'
import { useCallback, useEffect, useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { useTranslation } from 'react-i18next'
import { z } from 'zod'

import { useSetValue } from '~/hooks/useSetValue'

import { FormActions } from './FormActions.tsx'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog.tsx'
import { Input } from './ui/input.tsx'
import { Label } from './ui/label.tsx'
import { Switch } from './ui/switch.tsx'

const schema = z.object({
  link: z.string().min(1, 'Link is required'),
  tag: z.string().min(1, 'Tag is required'),
  cronExp: z.string().min(1, 'Cron expression is required'),
  cronEnable: z.boolean(),
})

type FormValues = z.infer<typeof schema>

export interface EditSubscriptionFormModalProps {
  opened: boolean
  onClose: () => void
  subscription?: {
    id: string
    link: string
    tag: string
    cronExp: string
    cronEnable: boolean
  }
  onSubmit: (values: FormValues & { id: string }) => Promise<void>
}

export function EditSubscriptionFormModal({ opened, onClose, subscription, onSubmit }: EditSubscriptionFormModalProps) {
  const { t } = useTranslation()
  const [submitFailed, setSubmitFailed] = useState(false)

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { link: '', tag: '', cronExp: '10 */6 * * *', cronEnable: true },
    mode: 'onChange',
  })

  const {
    handleSubmit,
    control,
    setValue: setValueOriginal,
    reset,
    formState: { errors, isDirty, isSubmitting },
  } = form

  const setValue = useSetValue(setValueOriginal)
  const formValues = useWatch({ control })

  // Initialize form when modal opens with subscription data
  useEffect(() => {
    if (opened && subscription) {
      setSubmitFailed(false)
      reset({
        link: subscription.link,
        tag: subscription.tag,
        cronExp: subscription.cronExp,
        cronEnable: subscription.cronEnable,
      })
    }
  }, [opened, subscription, reset])

  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (isSubmitting) return
      if (!open) {
        onClose()
        setTimeout(() => {
          reset({ link: '', tag: '', cronExp: '10 */6 * * *', cronEnable: true })
        }, 200)
      }
    },
    [isSubmitting, onClose, reset],
  )

  const handleFormSubmit = async (data: FormValues) => {
    setSubmitFailed(false)
    try {
      if (subscription) {
        await onSubmit({ ...data, id: subscription.id })
        onClose()
      }
    } catch {
      setSubmitFailed(true)
    }
  }

  return (
    <Dialog open={opened} onOpenChange={handleOpenChange}>
      <DialogContent
        onEscapeKeyDown={(event) => {
          if (isSubmitting) event.preventDefault()
        }}
        onInteractOutside={(event) => {
          if (isSubmitting) event.preventDefault()
        }}
      >
        <DialogHeader>
          <DialogTitle>{t('editSubscription')}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(handleFormSubmit)} className="flex flex-col gap-4">
          <fieldset disabled={isSubmitting} className="flex flex-col gap-4">
            <Input
              label={t('link')}
              withAsterisk
              value={formValues.link}
              onChange={(e) => setValue('link', e.target.value)}
              error={errors.link?.message}
            />
            <Input
              label={t('tag')}
              withAsterisk
              value={formValues.tag}
              onChange={(e) => setValue('tag', e.target.value)}
              error={errors.tag?.message}
            />
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="cronEnable">{t('autoUpdate')}</Label>
                <Switch
                  id="cronEnable"
                  checked={formValues.cronEnable}
                  onCheckedChange={(checked) => setValue('cronEnable', checked)}
                />
              </div>
              {formValues.cronEnable && (
                <Input
                  label={t('cronExpression')}
                  withAsterisk
                  value={formValues.cronExp}
                  onChange={(e) => setValue('cronExp', e.target.value)}
                  error={errors.cronExp?.message}
                  placeholder="10 */6 * * *"
                />
              )}
            </div>
            <FormActions
              loading={isSubmitting}
              reset={() => reset({ link: '', tag: '', cronExp: '10 */6 * * *', cronEnable: true })}
              isDirty={isDirty}
              errors={errors}
            />
            {submitFailed && (
              <p role="alert" className="text-sm text-destructive">
                {t('panel.saveFailed')}
              </p>
            )}
          </fieldset>
        </form>
      </DialogContent>
    </Dialog>
  )
}
