import { useScene } from '@/components/three/sceneStore';
import { Badge, Card } from '@/components/ui';
import { api } from '@/lib/api';
import { CATEGORY_META } from '@/lib/categories';
import { config, isSupabaseConfigured, LIMITS } from '@/lib/config';
import { DEFAULT_WEIGHTS } from '@/lib/severity';
import { CATEGORIES } from '@/lib/types';

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4 py-2 text-sm"><dt className="text-ink-2">{k}</dt><dd className="text-right font-mono text-xs">{v}</dd></div>;
}

export default function Settings() {
  useScene({ variant: 'dashboard' });
  const w = DEFAULT_WEIGHTS;
  return (
    <div className="space-y-6">
      <header>
        <p className="eyebrow">Settings</p>
        <h1 className="mt-2 text-3xl font-extrabold">Configuration</h1>
      </header>

      <Card className="p-5">
        <h2 className="font-bold">Services</h2>
        <dl className="mt-3 divide-y divide-line">
          <Row k="Backend" v={isSupabaseConfigured ? <Badge tone="green">Supabase connected</Badge> : <Badge tone="orange">Local demo mode</Badge>} />
          <Row k="Realtime" v={api.mode === 'demo' ? 'Cross-tab sync (demo)' : 'Supabase Realtime'} />
          <Row k="Map tiles" v={config.tileUrl.replace(/^https?:\/\//, '').split('/')[0]} />
          <Row k="Geocoding" v={config.geocoderUrl ? new URL(config.geocoderUrl).host : <Badge tone="muted">Not configured</Badge>} />
          <Row k="Routing" v={config.routingUrl ? new URL(config.routingUrl).host : <Badge tone="muted">Not configured — external directions link used</Badge>} />
          <Row k="Photo limit" v={`${LIMITS.maxImages} × ${LIMITS.maxImageBytes / 1048576} MB`} />
          <Row k="Report rate limit" v={`${LIMITS.reportsPerWindow} per ${LIMITS.rateWindowMs / 60000} min`} />
          <Row k="Duplicate radius" v={`${LIMITS.duplicateRadiusM} m / ${LIMITS.duplicateWindowH} h`} />
        </dl>
        <p className="mt-3 text-xs text-ink-3">Provider URLs and keys are set through environment variables (see <code>.env.example</code>). Secrets are never stored in the browser.</p>
      </Card>

      <Card className="p-5">
        <h2 className="font-bold">Severity model weights</h2>
        <p className="mt-1 text-sm text-ink-2">Scores are computed on the server from the <code>severity</code> row in <code>app_settings</code>; administrators can tune weights there. Current defaults:</p>
        <div className="mt-4 grid gap-6 md:grid-cols-2">
          <dl className="divide-y divide-line">
            {CATEGORIES.map((c) => <Row key={c} k={CATEGORY_META[c].label} v={`+${w.category[c]}`} />)}
          </dl>
          <dl className="divide-y divide-line">
            <Row k="Immediate danger to people" v={`+${w.immediateDanger}`} />
            <Row k="Electrical exposure" v={`+${w.electricalExposure}`} />
            <Row k="Open ground opening" v={`+${w.openGround}`} />
            <Row k="Exposure (both / one / unknown)" v={`+${w.exposure.both} / +${w.exposure.pedestrians} / +${w.exposure.unknown}`} />
            <Row k="Blocks road" v={`+${w.roadObstruction}`} />
            <Row k="Evidence (photo + description)" v={`max +${w.confidence.max}`} />
            <Row k="Corroboration" v={`+${w.corroboration.perReport} each, max +${w.corroboration.max}`} />
            <Row k="Time unresolved" v={`+${w.duration.perDay}/day, max +${w.duration.max}`} />
            <Row k="Life-threatening floor" v={`${w.floors.lifeThreateningCategory} (active: ${w.floors.lifeThreateningAndActive})`} />
            <Row k="Thresholds" v={`Critical ≥${w.thresholds.critical} · High ≥${w.thresholds.high} · Medium ≥${w.thresholds.medium}`} />
          </dl>
        </div>
      </Card>
    </div>
  );
}
