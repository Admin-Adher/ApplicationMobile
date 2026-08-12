import Image from 'next/image';
import buildTrackIcon from '../../../assets/images/icon.png';
import styles from './BuildTrackBrand.module.css';

type BuildTrackBrandProps = {
  variant?: 'mark' | 'wordmark';
  size?: 'xs' | 'sm' | 'md' | 'lg';
};

export function BuildTrackBrand({
  variant = 'wordmark',
  size = 'sm',
}: BuildTrackBrandProps) {
  const markOnly = variant === 'mark';

  return (
    <span
      className={styles.brand}
      data-size={size}
      {...(markOnly ? { role: 'img', 'aria-label': 'BuildTrack' } : {})}
    >
      <span className={styles.mark} aria-hidden="true">
        <Image
          className={styles.image}
          src={buildTrackIcon}
          alt=""
          fill
          sizes="(max-width: 720px) 38px, 56px"
          priority={size === 'lg'}
        />
      </span>
      {!markOnly && <span className={styles.wordmark}>BuildTrack</span>}
    </span>
  );
}
