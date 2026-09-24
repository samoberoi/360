import { createFileRoute, Link } from '@tanstack/react-router'

export const Route = createFileRoute('/privacypolicy')({
  head: () => ({
    meta: [
      { title: 'Privacy Policy — PLUS 360 FAHRENHEIT SOLUTIONS' },
      {
        name: 'description',
        content:
          'How PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD. collects, uses, stores and protects personal data in the PLUS 360 workforce app, including location, camera and notification data.',
      },
      { property: 'og:title', content: 'Privacy Policy — PLUS 360 FAHRENHEIT SOLUTIONS' },
      {
        property: 'og:description',
        content:
          'Privacy Policy for the PLUS 360 workforce app: data we collect, why we collect it, how it is shared, retained and deleted.',
      },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary' },
    ],
    links: [{ rel: 'canonical', href: 'https://radiant.hyperrevamp.com/privacypolicy' }],
  }),
  component: PrivacyPolicyPage,
})

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-8">
      <h2 className="text-lg font-semibold text-foreground">{title}</h2>
      <div className="mt-2 space-y-3 text-sm leading-relaxed text-muted-foreground">{children}</div>
    </section>
  )
}

function PrivacyPolicyPage() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-14">
      <h1 className="text-3xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>
      <p className="mt-3 text-sm text-muted-foreground">Last updated: 16 September 2026</p>
      <p className="mt-5 text-sm leading-relaxed text-muted-foreground">
        This Privacy Policy explains how PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD. (&ldquo;PLUS 360&rdquo;,
        &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, shares, stores and protects personal data
        in the PLUS 360 mobile application and web portal (the &ldquo;App&rdquo;). The App is a
        private workforce-management tool used by PLUS 360 employees, field officers and
        authorised client contacts. It is not intended for use by children.
      </p>

      <Section title="Who is responsible for your data">
        <p>
          PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD., Pune, Maharashtra, India, is the data fiduciary. For any
          privacy question or request, write to{' '}
          <a className="text-primary underline" href="mailto:info@radiantguards.com">
            info@radiantguards.com
          </a>
          .
        </p>
      </Section>

      <Section title="Data we collect">
        <ul className="list-disc space-y-2 pl-5">
          <li>
            <strong className="text-foreground">Account and identity data:</strong> name, employee
            code, mobile number, email, date of birth, gender, photograph, designation, unit and
            reporting details.
          </li>
          <li>
            <strong className="text-foreground">Government identifiers</strong> where employment law
            requires them: Aadhaar number, PAN, PF/UAN, ESIC number, bank account and IFSC. These are
            collected only for payroll, statutory filings and identity verification.
          </li>
          <li>
            <strong className="text-foreground">Location data:</strong> precise GPS location captured
            only at the moment you mark attendance (check-in / check-out) or record a site visit. The
            App does not track your location in the background.
          </li>
          <li>
            <strong className="text-foreground">Camera and photos:</strong> photographs you capture
            for attendance, site-visit reports or document uploads. We access the camera only when
            you start such an action.
          </li>
          <li>
            <strong className="text-foreground">Device and notification data:</strong> device model,
            operating-system version, app version and push-notification token, used to deliver
            duty-related alerts and to diagnose faults.
          </li>
          <li>
            <strong className="text-foreground">Usage and audit logs:</strong> sign-in events, actions
            taken in the App and IP address, retained for security and audit purposes.
          </li>
          <li>
            <strong className="text-foreground">Biometrics:</strong> if you enable Face ID / fingerprint
            unlock, verification happens entirely on your device. We never receive or store biometric
            data.
          </li>
        </ul>
      </Section>

      <Section title="Why we use your data">
        <ul className="list-disc space-y-2 pl-5">
          <li>To verify identity and authenticate sign-in via one-time password.</li>
          <li>To record attendance, duty rosters, site visits and extra duty.</li>
          <li>To process payroll, statutory contributions and compliance filings.</li>
          <li>To issue uniforms, assets and inventory, and to track their return.</li>
          <li>To send operational notifications about duty, approvals and attendance.</li>
          <li>To keep the App secure, prevent misuse and maintain audit trails.</li>
        </ul>
      </Section>

      <Section title="Legal basis">
        <p>
          We process personal data to perform our employment or service contract with you, to comply
          with Indian labour, tax and statutory obligations, and, where required, on the basis of your
          consent (for example, device permissions for location, camera and notifications). You may
          withdraw a device permission at any time in your phone settings; some features, such as
          marking attendance, will then not work.
        </p>
      </Section>

      <Section title="How data is shared">
        <p>
          We do not sell personal data and we do not use it for advertising. Data is shared only with:
        </p>
        <ul className="list-disc space-y-2 pl-5">
          <li>Authorised PLUS 360 personnel on a need-to-know basis.</li>
          <li>
            Client organisations, limited to deployment and attendance information for guards posted
            at their sites.
          </li>
          <li>
            Government authorities such as EPFO, ESIC and tax departments, where legally required.
          </li>
          <li>
            Service providers who host or support the App (cloud hosting and database, SMS/OTP
            delivery, push-notification delivery, identity-verification services and document-reading
            services), acting under contract and only on our instructions.
          </li>
        </ul>
      </Section>

      <Section title="Security and storage">
        <p>
          Data is stored on managed cloud infrastructure with encryption in transit and at rest,
          role-based access control and row-level access rules so users see only records within their
          own scope. Access is logged.
        </p>
      </Section>

      <Section title="Retention">
        <p>
          We retain personal data for the duration of your employment or engagement, and afterwards
          only for the period required by statutory payroll, tax and labour-law record-keeping
          obligations. Data no longer required is deleted or anonymised.
        </p>
      </Section>

      <Section title="Your rights">
        <p>
          Under the Digital Personal Data Protection Act, 2023 you may request access to, correction
          of, or deletion of your personal data, and you may withdraw consent where processing is
          based on consent. To delete your data, use our{' '}
          <Link className="text-primary underline" to="/request-data-deletion">
            data-deletion request form
          </Link>{' '}
          or email{' '}
          <a className="text-primary underline" href="mailto:info@radiantguards.com">
            info@radiantguards.com
          </a>
          . We respond within 30 days, except where records must be retained by law.
        </p>
      </Section>

      <Section title="Account deletion">
        <p>
          You can request deletion of your account and associated personal data at any time through the{' '}
          <Link className="text-primary underline" to="/request-data-deletion">
            data-deletion request form
          </Link>
          . Statutory payroll and compliance records that we are legally obliged to keep are retained
          for the mandated period and then destroyed.
        </p>
      </Section>

      <Section title="Changes to this policy">
        <p>
          We may update this policy. The revised version will be published on this page with a new
          &ldquo;last updated&rdquo; date.
        </p>
      </Section>

      <Section title="Contact">
        <p>
          PLUS 360 FAHRENHEIT SOLUTIONS PVT. LTD., Pune, Maharashtra, India ·{' '}
          <a className="text-primary underline" href="mailto:info@radiantguards.com">
            info@radiantguards.com
          </a>
        </p>
      </Section>
    </main>
  )
}
