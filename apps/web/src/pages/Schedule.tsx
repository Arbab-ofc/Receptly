import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm, useFieldArray } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { hoursSchema, defaultHours, type Hours, type Settings } from '@receptly/shared';
import { Copy, ArrowRight, CalendarClock } from 'lucide-react';
import { api, apiVersioned } from '../lib/api';
import { useRef, useState } from 'react';
import { useUnsavedChanges } from '../components/UnsavedChanges';
import {
  PageHeader,
  Button,
  Toggle,
  Field,
  Section,
  Skeleton,
  ErrorState,
  toast,
  SaveBar,
} from '../components/ui';
const schema = z.object({ days: hoursSchema });
export default function Schedule() {
  const query = useQuery({
    queryKey: ['schedule', 'versioned'],
    queryFn: () => apiVersioned<Hours>('schedule'),
  });
  const settings = useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('settings') });
  return (
    <>
      <PageHeader
        eyebrow="ON YOUR SCHEDULE"
        title="Business hours"
        description={`Your receptionist follows your time, in ${settings.data?.timezone || 'your business timezone'}.`}
      />
      <p>
        <Link to="/dashboard/holidays">Manage holiday closures and special hours</Link>
      </p>
      {query.isLoading ? (
        <Skeleton variant="form" />
      ) : query.isError ? (
        <ErrorState error={query.error} retry={() => void query.refetch()} />
      ) : (
        <ScheduleForm hours={query.data?.data || defaultHours} etag={query.data?.etag || null} />
      )}
    </>
  );
}
function ScheduleForm({ hours, etag }: { hours: Hours; etag: string | null }) {
  const client = useQueryClient();
  const version = useRef(etag);
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { days: [...hours].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7)) },
  });
  const fields = useFieldArray({ control: form.control, name: 'days' });
  const values = form.watch('days');
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const { guard } = useUnsavedChanges(form.formState.isDirty, form.formState.isSubmitting);
  return (
    <form
      onSubmit={form.handleSubmit(async (v) => {
        try {
          const saved = await apiVersioned<Hours>(
            'schedule',
            'PATCH',
            v.days,
            version.current ? { 'If-Match': version.current } : undefined,
          );
          version.current = saved.etag;
          form.reset(v);
          setSavedAt(Date.now());
          void client.invalidateQueries({ queryKey: ['schedule'] });
          toast('Business hours saved');
        } catch (e) {
          form.setError('root', { message: (e as Error).message });
        }
      })}
    >
      <Section
        title="Weekly schedule"
        action={
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const monday = values.find((d) => d.day === 1)!;
              values.forEach((day, i) => {
                if (day.day > 1 && day.day < 6)
                  form.setValue(
                    `days.${i}`,
                    { ...monday, day: day.day },
                    { shouldDirty: true, shouldValidate: true },
                  );
              });
            }}
          >
            <Copy size={15} />
            Copy Monday to weekdays
          </Button>
        }
      >
        <div className="schedule-list">
          {fields.fields.map((field, i) => (
            <div className={`schedule-row ${values[i].enabled ? '' : 'closed'}`} key={field.id}>
              <div>
                <strong>
                  {
                    ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
                      values[i].day
                    ]
                  }
                </strong>
                <Toggle
                  label={`Enable ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][values[i].day]}`}
                  checked={values[i].enabled}
                  onChange={(v) => form.setValue(`days.${i}.enabled`, v, { shouldDirty: true })}
                />
              </div>
              {values[i].enabled ? (
                <div className="schedule-times">
                  <Field label="Opens" error={form.formState.errors.days?.[i]?.open?.message}>
                    <input type="time" {...form.register(`days.${i}.open`)} />
                  </Field>
                  <ArrowRight size={17} />
                  <Field label="Closes" error={form.formState.errors.days?.[i]?.close?.message}>
                    <input type="time" {...form.register(`days.${i}.close`)} />
                  </Field>
                  {values[i].open > values[i].close && <small>Next day</small>}
                </div>
              ) : (
                <span className="muted">Closed all day</span>
              )}
            </div>
          ))}
        </div>
        <div className="schedule-note">
          <CalendarClock size={19} />
          <span>
            After closing, customers receive your out-of-hours reply. Overnight intervals continue
            into the following day.
          </span>
        </div>
      </Section>
      {Object.keys(form.formState.errors).length > 0 && (
        <p className="field-error" role="alert">
          {form.formState.errors.root?.message ||
            'Review the schedule. Opening and closing times must be different.'}
        </p>
      )}
      <SaveBar
        dirty={form.formState.isDirty}
        saving={form.formState.isSubmitting}
        savedAt={savedAt}
        label="Save business hours"
      />
      {guard}
    </form>
  );
}
