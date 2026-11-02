import type { Artifact } from "../shared/types.ts";

const KIND_LABEL: Record<Artifact["kind"], string> = { artifact: "art", pr: "pr", other: "link" };

export function ArtifactList(props: { artifacts: Artifact[] }) {
  if (props.artifacts.length === 0) return null;
  return (
    <div className="panel">
      <div className="panel-head">
        <span>artifacts</span>
        <span className="panel-sub">{props.artifacts.length}</span>
      </div>
      <ul className="artifact-list">
        {props.artifacts.map((a, i) => (
          <li key={a.url ?? i}>
            <span className={`chip kind-${a.kind}`}>{KIND_LABEL[a.kind]}</span>
            {a.url ? (
              <a href={a.url} target="_blank" rel="noreferrer">
                {a.title}
              </a>
            ) : (
              <span>{a.title}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
