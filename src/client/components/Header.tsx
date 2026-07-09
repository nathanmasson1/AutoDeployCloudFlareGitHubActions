interface HeaderProps {
  eyebrow: string;
  title: string;
  subtitle: string;
}

export function Header({ eyebrow, title, subtitle }: HeaderProps) {
  return (
    <div className="section-head">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h2>{title}</h2>
      </div>
      <p>{subtitle}</p>
    </div>
  );
}
