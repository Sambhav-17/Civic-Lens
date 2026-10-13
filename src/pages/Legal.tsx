import { Link, useParams } from 'react-router-dom';
import { useScene } from '@/components/three/sceneStore';
import { Card } from '@/components/ui';
import NotFound from './NotFound';

const DOCS: Record<string, { title: string; body: [string, string][] }> = {
  privacy: {
    title: 'Privacy',
    body: [
      ['What we publish', 'Public pages show the hazard type, its location, approved photos, a description and the repair status. Reporter names, emails and phone numbers are never published.'],
      ['Anonymous reports', 'You can report without an account. Anonymous reports are not linked to any profile.'],
      ['Photos', 'Photos are compressed in your browser and their embedded metadata (including GPS) is removed before upload. Moderators remove images that show faces, number plates or other personal details.'],
      ['Location', 'We only read your device location after you press “Use my location” and your browser asks for permission. You can always place the pin by hand instead.'],
      ['Retention & requests', 'Contact the operating municipality to request access to, or deletion of, your account data.'],
    ],
  },
  accessibility: {
    title: 'Accessibility',
    body: [
      ['Our commitment', 'CivicLens aims to meet WCAG 2.2 AA. Every workflow, including reporting a hazard, can be completed with a keyboard and a screen reader.'],
      ['Maps', 'Every map has a list view with the same information. Severity is shown with colour, a symbol and a text label.'],
      ['Motion', 'Animations and the 3D background are reduced when your device is set to reduce motion, and pause when the tab is hidden. A static background is used where WebGL is unavailable.'],
      ['Feedback', 'If something doesn’t work for you, tell us via the contact page and we’ll fix it.'],
    ],
  },
  terms: {
    title: 'Terms of use',
    body: [
      ['Not an emergency service', 'CivicLens is a civic reporting platform, not an emergency dispatch service. For immediate danger, call your local emergency number (112 in India).'],
      ['Stay safe', 'Never approach electrical wires, open manholes, floodwater or unstable structures to collect evidence.'],
      ['Accurate reports', 'Report real hazards honestly. Spam, abuse and deliberately false reports are removed and may lead to account suspension.'],
      ['Severity scores', 'Automated severity scores are preliminary. Only authorised municipal personnel confirm official urgency. The absence of a report does not mean a road is safe.'],
    ],
  },
  contact: {
    title: 'Contact',
    body: [
      ['Emergencies', 'Call 112. Do not use CivicLens for emergencies.'],
      ['Report status questions', 'Open your report from “My reports” or its incident link to see the full activity history.'],
      ['Municipal partners', 'Cities deploying CivicLens publish their support contact here. Configure this page for your deployment in src/pages/Legal.tsx.'],
    ],
  },
};

export default function Legal() {
  useScene({ variant: 'profile' });
  const { doc = '' } = useParams();
  const d = DOCS[doc];
  if (!d) return <NotFound />;
  return (
    <div className="container-x max-w-3xl py-12">
      <p className="eyebrow">CivicLens</p>
      <h1 className="mt-2 text-4xl font-extrabold">{d.title}</h1>
      <Card className="mt-8 space-y-6 p-6 sm:p-8">
        {d.body.map(([h, p]) => (
          <section key={h}><h2 className="text-lg font-bold">{h}</h2><p className="mt-1.5 text-ink-2">{p}</p></section>
        ))}
      </Card>
      <nav className="mt-6 flex flex-wrap gap-4 text-sm" aria-label="Policies">
        {Object.entries(DOCS).map(([k, v]) => <Link key={k} to={`/legal/${k}`} className={k === doc ? 'font-semibold text-ink' : 'link'}>{v.title}</Link>)}
      </nav>
    </div>
  );
}
