import type { PanelProps } from '../onboarding-state';
import { PairingPreview } from '../previews/phone-pairing';
import { Cta, Eyebrow, FootActions, Heading, Icon, Sub, Toggle, buttonProps } from '../primitives';
import { box } from '../stage';

/**
 * CDXC:Onboarding 2026-09-15 DECISION:
 * User: "in the take ghostex with you section, we need to not download the app. We should just have a toggle saying
 * 'Configure my phone with ghostex after this flow' and all that does is it opens the sidebar menu -> remote screen
 * for the user after the flow". The install/pair steps and the APK link are gone; the toggle sets `phoneQueued`, which
 * finishOnboarding turns into Settings -> Remote (Easy Connect) once the flow closes.
 */
export function MobilePanel({ props, flow, setFlow, go, toast }: PanelProps) {
  const { settings } = props;
  const notify = settings?.showMacOSAttentionNotifications ?? true;
  const togglePhone = () => setFlow({ phoneQueued: !flow.phoneQueued });
  const toggleNotify = () => {
    if (!settings) return;
    props.onChange({ ...settings, showMacOSAttentionNotifications: !notify });
  };
  return (
    <>
      <Eyebrow x={46} y={146}>
        Optional · Mobile
      </Eyebrow>
      <Heading x={46} y={174} w={700} size={52} l1='Take the session with you.' />
      <Sub x={46} y={250} w={660} size={16}>
        The agents keep running on your computer while you reply, steer and keep working from your phone.
      </Sub>
      <div
        className={'glass vrow' + (flow.phoneQueued ? ' on' : '')}
        style={box(46, 326, 660, 84)}
        {...buttonProps(togglePhone)}
      >
        <Icon n='phone' size={22} className='vicon' />
        <div>
          <div className='nm lg'>Configure my phone with Ghostex after this flow</div>
          <div className='ss'>
            {flow.phoneQueued
              ? 'Settings → Remote opens when you finish: turn on Easy Connect and scan the code with Ghostex Mobile.'
              : 'Pair Ghostex Mobile right after setup, so every session is on your phone too.'}
          </div>
        </div>
        <Toggle on={flow.phoneQueued} onClick={togglePhone} label='Configure my phone with Ghostex after this flow' />
      </div>
      <div
        className={'glass vrow' + (notify ? ' on' : '')}
        style={box(46, 426, 660, 84)}
        {...buttonProps(toggleNotify)}
      >
        <Icon n='bell' size={22} className='vicon' />
        <div>
          <div className='nm lg'>Ping me when an agent needs me</div>
          <div className='ss'>
            {notify
              ? 'This computer and your phone alert you when an agent needs an answer.'
              : 'No alerts on this computer or your phone: you find out when you look.'}
          </div>
        </div>
        <Toggle on={notify} onClick={toggleNotify} label='Ping me when an agent needs me' />
      </div>
      <p className='note' style={{ position: 'absolute', left: 46, top: 534 }}>
        You can set this up anytime from <b>Settings → Remote</b>.
      </p>
      <FootActions panel={4}>
        <Cta filled onClick={() => go(5)}>
          Next
        </Cta>
      </FootActions>
      <PairingPreview notify={notify} toast={toast} />
    </>
  );
}
