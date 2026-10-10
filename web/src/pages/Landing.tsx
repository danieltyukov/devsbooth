import { ButtonLink } from '../components/Button';
import styles from './Landing.module.css';

/** A still of a room in progress, with meters that move on their own. Decorative. */
const DEMO = [
  { name: 'Mira Okafor', initials: 'MO', tone: '#3d5a80', host: true, pattern: 'a' },
  { name: 'Jonas Berg', initials: 'JB', tone: '#2f6f73', host: false, pattern: 'b' },
  { name: 'Priya Raman', initials: 'PR', tone: '#7a4b6b', host: false, pattern: 'c' },
] as const;

export function Landing() {
  return (
    <div className={`container ${styles.page}`}>
      <section className={styles.hero}>
        <div className={styles.copy}>
          <h1 className={styles.title}>Audio rooms for developers.</h1>
          <p className={styles.lede}>
            Open a room, talk through what you are building, and let people drop in to listen or take the mic.
            DevsBooth is open source and runs on your own server.
          </p>
          <div className={styles.actions}>
            <ButtonLink to="/signin" size="l">
              Sign in with email
            </ButtonLink>
            <a className={styles.source} href="https://github.com/danieltyukov/devsbooth">
              Source on GitHub
            </a>
          </div>
        </div>

        <figure className={styles.demo} aria-label="A room in progress with three speakers">
          <figcaption className={styles.demoTopic}>
            Is the TypeScript 7 compiler worth migrating to?
          </figcaption>
          <div className={styles.strips}>
            {DEMO.map((person) => (
              <div key={person.name} className={styles.strip}>
                <div className={styles.stripTop}>
                  <span className={styles.face} style={{ background: person.tone }}>
                    {person.initials}
                  </span>
                  <span className={`${styles.meter} ${styles[person.pattern]}`} aria-hidden="true">
                    {Array.from({ length: 10 }, (_, i) => (
                      <span key={i} />
                    ))}
                  </span>
                </div>
                <span className={styles.stripName}>{person.name}</span>
                {person.host && <span className={styles.stripRole}>Host</span>}
              </div>
            ))}
          </div>
          <p className={styles.demoAudience}>14 listening, 2 hands up</p>
        </figure>
      </section>

      <section className={styles.facts} aria-label="How it works">
        <div>
          <h2 className={styles.factTitle}>Three kinds of room</h2>
          <p>
            Open rooms are listed for everyone, follower rooms for the people who follow you, and private
            rooms only for whoever has the link.
          </p>
        </div>
        <div>
          <h2 className={styles.factTitle}>Speakers and listeners</h2>
          <p>
            Listeners join muted and raise a hand to talk. The host invites them up, moves people back, and
            ends the room.
          </p>
        </div>
        <div>
          <h2 className={styles.factTitle}>Peer to peer audio</h2>
          <p>
            Voices travel directly between browsers over WebRTC. The server only introduces people and keeps
            track of who is in the room.
          </p>
        </div>
      </section>
    </div>
  );
}
