import { useQuery } from '@tanstack/react-query';

type Credit = {
  kind: string;
  title: string;
  author: string;
  licence: string;
  licence_url: string;
  page: string;
};

/** Product photos come from Wikimedia Commons under free licences that require credit. */
export function CreditsPage() {
  const { data, isPending, isError } = useQuery({
    queryKey: ['photo-credits'],
    queryFn: async (): Promise<Credit[]> => {
      const res = await fetch('/img/products/credits.json');
      if (!res.ok) throw new Error('credits');
      return res.json();
    },
    staleTime: Infinity,
  });

  return (
    <div className="page narrow">
      <h1>Photo credits</h1>
      <p className="muted">
        Product photos are from Wikimedia Commons, used under the licences below. Each one was
        cropped and resized to fit the shop. Photos staff upload in the admin area are theirs.
      </p>
      {isPending && <p className="muted">Loading…</p>}
      {isError && <p className="muted">The credits list couldn’t be loaded.</p>}
      {data && (
        <ul className="credits-list">
          {data.map((c) => (
            <li key={c.kind}>
              <img src={`/img/products/${c.kind}.webp`} alt="" loading="lazy" />
              <div>
                <span className="kind">{c.kind}</span>
                <p>
                  <a href={c.page} target="_blank" rel="noreferrer">
                    {c.title.replace(/^File:/, '')}
                  </a>{' '}
                  by {c.author},{' '}
                  {c.licence_url ? (
                    <a href={c.licence_url} target="_blank" rel="noreferrer">{c.licence}</a>
                  ) : (
                    c.licence
                  )}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
