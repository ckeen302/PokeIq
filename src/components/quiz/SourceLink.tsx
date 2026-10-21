/** Where a trivia answer was checked: shown after the reveal, so fans can look it up. */
export function SourceLink({ href }: { href: string }) {
  return (
    <>
      {" "}
      <a href={href} target="_blank" rel="noopener noreferrer" className="font-medium text-screen hover:underline">
        Source: Bulbapedia ↗
      </a>
    </>
  );
}
