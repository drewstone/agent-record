import type { ScientificReview } from '../workspace.js'

function tone(label: string) {
  if (label === 'WRONG') return 'fail'
  if (label === 'UNVERIFIABLE' || label === 'unresolved' || label === 'stale') return 'warn'
  if (label === 'NEW') return 'info'
  return 'neutral'
}

function reviewLabel(review: ScientificReview) {
  return review.status === 'decided' && review.label ? review.label : `review ${review.status}`
}

function confidence(value: ScientificReview['confidence']) {
  if (typeof value === 'number') return `${Math.round(value * 100)}% confidence`
  return value ? `${value} confidence` : null
}

function external(url: string) {
  try { return ['http:', 'https:'].includes(new URL(url).protocol) } catch { return false }
}

/** Per-claim verdict counts keep a multi-claim page from implying that one verdict covers its whole result. */
export function ReviewBadges({ reviews }: { reviews?: readonly ScientificReview[] }) {
  if (!reviews?.length) return <span className="ftag tone-neutral">review pending</span>
  const counts = new Map<string, number>()
  for (const review of reviews) {
    const label = reviewLabel(review)
    counts.set(label, (counts.get(label) ?? 0) + 1)
  }
  return <>{[...counts].map(([label, count]) => <span key={label} className={`ftag tone-${tone(label)}`}>{count > 1 ? `${count} ` : ''}{label}</span>)}</>
}

/** The review record is separate from the agent's own class and check pages. */
export function ReviewDetails({ reviews }: { reviews?: readonly ScientificReview[] }) {
  if (!reviews?.length) return <p className="faint review-note">Outside review is pending for this page.</p>
  return (
    <details className="scientific-reviews">
      <summary>Outside review of {reviews.length} {reviews.length === 1 ? 'claim' : 'claims'}</summary>
      <ol>
        {reviews.map((review) => (
          <li key={review.subject.claimId}>
            <div className="review-heading">
              <span className={`ftag tone-${tone(reviewLabel(review))}`}>{reviewLabel(review)}</span>
              <span className="mono">{review.subject.claimId}</span>
              {confidence(review.confidence) && <span className="faint">{confidence(review.confidence)}</span>}
            </div>
            <p>{review.claim}</p>
            {review.rationale && <p className="faint">{review.rationale}</p>}
            {review.rerun && <p className="faint">Check: {review.rerun.status}{review.rerun.description ? ` · ${review.rerun.description}` : review.rerun.output ? ` · ${review.rerun.output}` : ''}</p>}
            {review.priorArt && <p className="faint">Prior art: {review.priorArt.summary ?? review.priorArt.status}</p>}
            {!!review.priorArt?.references.length && <ul>{review.priorArt.references.map((reference, index) => (
              <li key={`${reference.url}:${index}`}>{external(reference.url)
                ? <a href={reference.url} target="_blank" rel="noopener noreferrer">{reference.title}</a>
                : reference.title}</li>
            ))}</ul>}
            {(review.sourceRef || typeof review.source === 'string') && <p className="faint">Review record: {(() => {
              const source = review.sourceRef ?? review.source as string
              return external(source)
                ? <a href={source} target="_blank" rel="noopener noreferrer">source</a>
                : <span className="mono">{source}</span>
            })()}</p>}
          </li>
        ))}
      </ol>
      <p className="faint review-note">A NEW verdict names a candidate at this review depth, not peer acceptance.</p>
    </details>
  )
}
