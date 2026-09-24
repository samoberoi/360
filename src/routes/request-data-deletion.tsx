import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'

export const Route = createFileRoute('/request-data-deletion')({
  head: () => ({
    meta: [
      { title: 'Request Data Deletion — PLUS 360 FAHRENHEIT SOLUTIONS' },
      {
        name: 'description',
        content:
          'Request deletion of your personal data held by PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD. Submit the form and our team will process your request within 30 days.',
      },
      { property: 'og:title', content: 'Request Data Deletion — PLUS 360 FAHRENHEIT SOLUTIONS' },
      {
        property: 'og:description',
        content: 'Submit a request to delete your personal data held by PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD.',
      },
      { property: 'og:type', content: 'website' },
    ],
    links: [
      { rel: 'canonical', href: 'https://radiant.hyperrevamp.com/request-data-deletion' },
    ],
  }),
  component: RequestDataDeletionPage,
})

function RequestDataDeletionPage() {
  const [fullName, setFullName] = useState('')
  const [mobile, setMobile] = useState('')
  const [email, setEmail] = useState('')
  const [message, setMessage] = useState('')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [errorText, setErrorText] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setStatus('submitting')
    setErrorText('')
    try {
      const res = await fetch('/api/public/data-deletion-request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fullName, mobile, email, message }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => null)
        throw new Error(data?.error || 'Submission failed')
      }
      setStatus('done')
    } catch (err) {
      setStatus('error')
      setErrorText(err instanceof Error ? err.message : 'Submission failed')
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">
        Request Data Deletion
      </h1>
      <p className="mt-4 text-muted-foreground leading-relaxed">
        PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD. respects your privacy under the Digital Personal Data
        Protection Act, 2023. Use this form to request deletion of the personal data we hold about
        you (for example, if you are a guard, field officer, or client contact whose details are
        stored in our system).
      </p>
      <p className="mt-3 text-muted-foreground leading-relaxed">
        Once verified, we will delete or anonymise your personal data within 30 days, except where
        we are legally required to retain it (such as statutory payroll and compliance records).
      </p>

      {status === 'done' ? (
        <div className="mt-10 rounded-lg border border-border bg-card p-6">
          <h2 className="text-lg font-medium text-foreground">Request received</h2>
          <p className="mt-2 text-muted-foreground">
            Thank you. Your data-deletion request has been recorded. Our team will verify your
            identity using the mobile number provided and complete the request within 30 days. If
            you have questions, write to{' '}
            <a className="text-primary underline" href="mailto:info@radiantguards.com">
              info@radiantguards.com
            </a>{' '}
            or call +91 83739 14073.
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-10 space-y-5 rounded-lg border border-border bg-card p-6">
          <div>
            <label htmlFor="fullName" className="block text-sm font-medium text-foreground">
              Full name <span aria-hidden="true">*</span>
            </label>
            <input
              id="fullName"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
              placeholder="As registered with PLUS 360"
            />
          </div>
          <div>
            <label htmlFor="mobile" className="block text-sm font-medium text-foreground">
              Registered mobile number <span aria-hidden="true">*</span>
            </label>
            <input
              id="mobile"
              required
              value={mobile}
              onChange={(e) => setMobile(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
              placeholder="+91 XXXXX XXXXX"
            />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-foreground">
              Email (optional)
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
            />
          </div>
          <div>
            <label htmlFor="message" className="block text-sm font-medium text-foreground">
              Details (optional)
            </label>
            <textarea
              id="message"
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-foreground"
              placeholder="Anything that helps us identify your record"
            />
          </div>
          {status === 'error' && (
            <p className="text-sm text-destructive">{errorText}</p>
          )}
          <button
            type="submit"
            disabled={status === 'submitting'}
            className="w-full rounded-md bg-primary px-4 py-2.5 font-medium text-primary-foreground disabled:opacity-60"
          >
            {status === 'submitting' ? 'Submitting…' : 'Submit deletion request'}
          </button>
        </form>
      )}

    </main>
  )
}
