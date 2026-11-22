import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Camera, Check, ImagePlus, LoaderCircle, Maximize2, MessageCircle, Mic, MicOff, Phone, PhoneOff, Search, Send, Settings2, Trash2, Undo2, UserPlus, Users, Volume2, VolumeX, X } from 'lucide-react';
import { translateUi, type AppLanguage } from './i18n';

type FriendsPageProps = {
  account: WestronAccount | null;
  gameRunning: boolean;
  language: AppLanguage;
  isActive: boolean;
  onOpenAccount: () => void;
  onOpenScreenshots: () => void;
  onOpenFriends: () => void;
  onNotification: (notification: FriendsNotification) => void;
  onDismissNotification: (id: string) => void;
};

export type FriendsNotification = {
  id: string;
  kind: 'friend-request' | 'message' | 'photo' | 'call';
  sender: string;
  message: string;
  actions?: {
    label: string;
    onClick: () => void;
    icon?: 'phone' | 'phone-off';
    variant?: 'secondary' | 'primary' | 'danger';
    dismissOnClick?: boolean;
  }[];
};

type ActiveCall = {
  callId: string;
  friendUserId: string;
  friendUsername: string;
  status: 'calling' | 'connecting' | 'active';
  groupId?: string;
  groupName?: string;
  groupMembers?: WestronFriendGroup['members'];
  temporaryGroup?: boolean;
  temporaryGroupOwner?: boolean;
  temporaryGroupOwnerUserId?: string;
};

type IncomingCall = {
  callId: string;
  fromUserId: string;
  fromUsername: string;
  sdp: string;
  groupId?: string;
  groupName?: string;
};

function getCallNotificationId(callId: string, groupId?: string) {
  return groupId ? `group-call:${groupId}:${callId}` : `call:${callId}`;
}

type RecallPrompt = {
  messageId: string;
  body: string;
  kind: 'text' | 'photo';
  groupId?: string;
};

type PeerMediaState = {
  microphoneMuted: boolean;
  speakerMuted: boolean;
};

const TEMPORARY_CALL_GROUP_PREFIX = 'Westron Call ';

const EMPTY_FRIENDS: WestronFriendList = {
  friends: [],
  incomingRequests: [],
  outgoingRequests: [],
};
const EMPTY_GROUP_MEMBERS: WestronFriendGroup['members'] = [];

const FRIEND_LOCALES: Record<AppLanguage, string> = {
  tr: 'tr-TR',
  en: 'en-US',
  de: 'de-DE',
  fr: 'fr-FR',
  es: 'es-ES',
  ru: 'ru-RU',
  it: 'it-IT',
};

const WESTRON_USERNAME_PATTERN = /^[A-Za-z0-9_]{3,16}$/;
const friendSkinUrlCache = new Map<string, { expiresAt: number; promise: Promise<string | null> }>();

function isNoiseSuppressionConstraintFailure(reason: unknown) {
  return typeof reason === 'object'
    && reason !== null
    && 'name' in reason
    && reason.name === 'OverconstrainedError'
    && 'constraint' in reason
    && reason.constraint === 'noiseSuppression';
}

async function captureMicrophoneStream(audio: MediaTrackConstraints) {
  try {
    return await navigator.mediaDevices.getUserMedia({ audio });
  } catch (reason) {
    if (audio.noiseSuppression !== true || !isNoiseSuppressionConstraintFailure(reason)) throw reason;
    return navigator.mediaDevices.getUserMedia({
      audio: { ...audio, noiseSuppression: { ideal: true } },
    });
  }
}

async function applyNoiseSuppressionConstraint(track: MediaStreamTrack, enabled: boolean) {
  try {
    await track.applyConstraints({ noiseSuppression: enabled });
  } catch (reason) {
    if (!enabled || !isNoiseSuppressionConstraintFailure(reason)) throw reason;
    await track.applyConstraints({ noiseSuppression: { ideal: true } });
  }
}

function getFriendSkinUrl(username: string, minecraftUsername?: string | null) {
  const normalizedUsername = typeof username === 'string' ? username.trim() : '';
  if (!WESTRON_USERNAME_PATTERN.test(normalizedUsername)) {
    console.warn('[Westron] Profil adı geçersiz olduğu için skin isteği atlandı.');
    return Promise.resolve(null);
  }
  const rawMinecraftUsername = typeof minecraftUsername === 'string' ? minecraftUsername.trim() : '';
  const normalizedMinecraftUsername = WESTRON_USERNAME_PATTERN.test(rawMinecraftUsername)
    ? rawMinecraftUsername
    : undefined;
  if (rawMinecraftUsername && !normalizedMinecraftUsername) {
    console.warn('[Westron] Minecraft kullanıcı adı geçersiz; skin araması Westron adıyla yapılacak.');
  }
  const cacheKey = `${normalizedUsername.toLowerCase()}:${normalizedMinecraftUsername?.toLowerCase() ?? ''}`;
  const cached = friendSkinUrlCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.promise;

  const promise = window.nocturne.getWestronFriendSkinUrl({
    username: normalizedUsername,
    minecraftUsername: normalizedMinecraftUsername,
  });
  friendSkinUrlCache.set(cacheKey, { promise, expiresAt: Date.now() + 5 * 60 * 1000 });
  return promise;
}

export function FriendSkinFace({
  username,
  minecraftUsername,
}: {
  username: string;
  minecraftUsername?: string | null;
}) {
  const [skinImageUrl, setSkinImageUrl] = useState('');
  const [legacySkin, setLegacySkin] = useState(false);
  const skinLoadFailedRef = useRef(false);
  const fallbackSkinUrlRef = useRef<string | null>(null);
  useEffect(() => {
    let active = true;
    skinLoadFailedRef.current = false;
    fallbackSkinUrlRef.current = null;
    setLegacySkin(false);
    setSkinImageUrl('');
    void getFriendSkinUrl(username, minecraftUsername)
      .then((url) => { if (active && url) setSkinImageUrl(url); });
    return () => { active = false; };
  }, [username, minecraftUsername]);
  const handleSkinError = () => {
    if (fallbackSkinUrlRef.current === skinImageUrl) {
      setSkinImageUrl('');
      return;
    }
    if (skinLoadFailedRef.current) return;
    skinLoadFailedRef.current = true;
    void window.nocturne.getMinecraftSkinUrl({ username: minecraftUsername || username })
      .then((url) => {
        if (url && url !== skinImageUrl) {
          fallbackSkinUrlRef.current = url;
          setSkinImageUrl(url);
        } else {
          setSkinImageUrl('');
        }
      })
      .catch(() => setSkinImageUrl(''));
  };
  if (!skinImageUrl) {
    return <div className="friends-face-fallback" aria-label={username}>{username.slice(0, 1).toUpperCase()}</div>;
  }
  return (
    <div className="skin-face-texture friends-face-texture" data-skin-format={legacySkin ? 'legacy' : 'modern'} aria-label={username}>
      <img className="skin-face-base" src={skinImageUrl} alt="" onLoad={(event) => setLegacySkin(event.currentTarget.naturalHeight * 2 === event.currentTarget.naturalWidth)} onError={handleSkinError} />
      <img className="skin-face-overlay" src={skinImageUrl} alt="" onLoad={(event) => setLegacySkin(event.currentTarget.naturalHeight * 2 === event.currentTarget.naturalWidth)} onError={handleSkinError} />
    </div>
  );
}

function FriendGroupPhoto({
  groupId,
  messageId,
  loadingText,
  errorText,
  imageAlt,
  onOpen,
}: {
  groupId: string;
  messageId: string;
  loadingText: string;
  errorText: string;
  imageAlt: string;
  onOpen: (imageUrl: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setImageUrl('');
    setFailed(false);
    void window.nocturne.getWestronGroupMessagePhoto({ groupId, messageId })
      .then((base64) => {
        if (active && base64) setImageUrl(`data:image/png;base64,${base64}`);
        else if (active) setFailed(true);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [groupId, messageId]);
  if (failed) return <span className="friends-photo-error">{errorText}</span>;
  if (!imageUrl) return <span className="friends-group-photo-loading"><LoaderCircle className="spin" size={13} />{loadingText}</span>;
  return (
    <button className="friends-photo-preview" type="button" onClick={() => onOpen(imageUrl)} aria-label={imageAlt}>
      <img className="friends-group-photo" src={imageUrl} alt={imageAlt} />
    </button>
  );
}

function FriendPhotoMessage({
  messageId,
  loadingText,
  errorText,
  imageAlt,
  onOpen,
}: {
  messageId: string;
  loadingText: string;
  errorText: string;
  imageAlt: string;
  onOpen: (imageUrl: string) => void;
}) {
  const [imageUrl, setImageUrl] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true;
    setImageUrl('');
    setFailed(false);
    void window.nocturne.getWestronMessagePhoto({ messageId })
      .then((base64) => {
        if (active && base64) setImageUrl(`data:image/png;base64,${base64}`);
        else if (active) setFailed(true);
      })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, [messageId]);
  if (failed) return <span className="friends-photo-error">{errorText}</span>;
  if (!imageUrl) return <span className="friends-group-photo-loading"><LoaderCircle className="spin" size={13} />{loadingText}</span>;
  return (
    <button className="friends-photo-preview" type="button" onClick={() => onOpen(imageUrl)} aria-label={imageAlt}>
      <img className="friends-photo-message" src={imageUrl} alt={imageAlt} />
    </button>
  );
}

function GroupCallAudio({
  userId,
  stream,
  volume,
  muted,
  speakerId,
  onSpeaking,
}: {
  userId: string;
  stream: MediaStream;
  volume: number;
  muted: boolean;
  speakerId: string;
  onSpeaking: (userId: string, speaking: boolean) => void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const onSpeakingRef = useRef(onSpeaking);
  onSpeakingRef.current = onSpeaking;
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return undefined;
    audio.srcObject = stream;
    audio.volume = volume;
    audio.muted = muted;
    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
    if (speakerId) void sinkAudio.setSinkId?.(speakerId).catch(() => undefined);
    void audio.play().catch(() => undefined);
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    const source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let active = true;
    let frame = 0;
    const detect = () => {
      if (!active) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const amplitude = (sample - 128) / 128;
        energy += amplitude * amplitude;
      }
      onSpeakingRef.current(userId, Math.sqrt(energy / samples.length) > 0.025);
      frame = window.requestAnimationFrame(detect);
    };
    void context.resume().catch(() => undefined);
    detect();
    return () => {
      active = false;
      window.cancelAnimationFrame(frame);
      source.disconnect();
      if (context.state !== 'closed') void context.close();
      audio.srcObject = null;
      onSpeakingRef.current(userId, false);
    };
  }, [stream, userId]);
  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = volume;
      audioRef.current.muted = muted;
      if (speakerId) {
        const sinkAudio = audioRef.current as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
        void sinkAudio.setSinkId?.(speakerId).catch(() => undefined);
      }
    }
  }, [volume, muted, speakerId]);
  return <audio ref={audioRef} autoPlay />;
}

function errorMessage(reason: unknown) {
  if (reason instanceof Error) return reason.message;
  return typeof reason === 'string' ? reason : 'İstek tamamlanamadı.';
}

function isMissingFriendsApi(reason: unknown) {
  const message = errorMessage(reason);
  return message.includes('Westron Skin API uç noktası sunucuda bulunamadı (404)')
    || message.includes('Westron Skin API isteği başarısız oldu (404)')
    || /\(404\)/.test(message);
}

function playSocialSound(kind: 'message' | 'photo' | 'call') {
  const fallback = () => {
    void window.nocturne.playWestronNotification(kind === 'call' ? 'call' : 'message').catch(() => undefined);
  };
  if (typeof window.AudioContext !== 'function') {
    fallback();
    return;
  }
  const notes = kind === 'call'
    ? [523.25, 659.25, 783.99]
    : kind === 'photo'
      ? [783.99, 987.77]
      : [659.25, 783.99];
  let context: AudioContext;
  try {
    context = new window.AudioContext();
  } catch {
    fallback();
    return;
  }
  const startAt = context.currentTime + 0.02;
  notes.forEach((frequency, index) => {
    const start = startAt + index * 0.16;
    const oscillator = context.createOscillator();
    const volume = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, start);
    volume.gain.setValueAtTime(0.0001, start);
    volume.gain.exponentialRampToValueAtTime(0.055, start + 0.02);
    volume.gain.exponentialRampToValueAtTime(0.0001, start + 0.13);
    oscillator.connect(volume);
    volume.connect(context.destination);
    oscillator.start(start);
    oscillator.stop(start + 0.14);
  });
  void context.resume().catch(() => {
    void context.close().catch(() => undefined);
    fallback();
  });
  window.setTimeout(() => { void context.close().catch(() => undefined); }, notes.length * 160 + 300);
}

function CallMuteBadges({ microphoneMuted, speakerMuted, text }: {
  microphoneMuted: boolean;
  speakerMuted: boolean;
  text: (value: string) => string;
}) {
  if (!microphoneMuted && !speakerMuted) return null;
  return (
    <span className="friends-call-mute-badges" aria-hidden="true">
      {microphoneMuted && <span className="friends-call-mute-badge" title={text('Mikrofon kapalı')}><MicOff size={11} /></span>}
      {speakerMuted && <span className="friends-call-mute-badge" title={text('Hoparlör kapalı')}><VolumeX size={11} /></span>}
    </span>
  );
}

export default function FriendsPage({
  account,
  gameRunning,
  language,
  isActive,
  onOpenAccount,
  onOpenScreenshots,
  onOpenFriends,
  onNotification,
  onDismissNotification,
}: FriendsPageProps) {
  const text = (value: string) => translateUi(language, value);
  const [friendList, setFriendList] = useState<WestronFriendList>(EMPTY_FRIENDS);
  const [conversation, setConversation] = useState<WestronConversationMessage[]>([]);
  const [groupConversation, setGroupConversation] = useState<WestronFriendGroupMessage[]>([]);
  const [selectedFriendId, setSelectedFriendId] = useState('');
  const [selectedGroupId, setSelectedGroupId] = useState('');
  const [username, setUsername] = useState('');
  const [friendSuggestions, setFriendSuggestions] = useState<{ userId: string; username: string }[]>([]);
  const [friendSearchFocused, setFriendSearchFocused] = useState(false);
  const [groups, setGroups] = useState<WestronFriendGroup[]>([]);
  const [groupModalOpen, setGroupModalOpen] = useState(false);
  const [groupSettingsOpen, setGroupSettingsOpen] = useState(false);
  const [groupDeletePrompt, setGroupDeletePrompt] = useState<WestronFriendGroup | null>(null);
  const [groupDeleteName, setGroupDeleteName] = useState('');
  const [groupDeletePhase, setGroupDeletePhase] = useState<'confirm' | 'verify'>('confirm');
  const [groupMembersOpen, setGroupMembersOpen] = useState(false);
  const [groupName, setGroupName] = useState('');
  const [groupNameDraft, setGroupNameDraft] = useState('');
  const [groupMemberIds, setGroupMemberIds] = useState<string[]>([]);
  const [friendQuery, setFriendQuery] = useState('');
  const [messageBody, setMessageBody] = useState('');
  const [activeCall, setActiveCall] = useState<ActiveCall | null>(null);
  const [incomingCall, setIncomingCall] = useState<IncomingCall | null>(null);
  const [microphoneMuted, setMicrophoneMuted] = useState(false);
  const [remoteAudioMuted, setRemoteAudioMuted] = useState(false);
  const [peerMediaStates, setPeerMediaStates] = useState<Record<string, PeerMediaState>>({});
  const [addCallParticipantOpen, setAddCallParticipantOpen] = useState(false);
  const [callParticipantId, setCallParticipantId] = useState('');
  const [remoteSpeaking, setRemoteSpeaking] = useState(false);
  const [selfSpeaking, setSelfSpeaking] = useState(false);
  const [voiceCallWindowVisible, setVoiceCallWindowVisible] = useState(false);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [presenceError, setPresenceError] = useState('');
  const [apiUnavailable, setApiUnavailable] = useState(false);
  const [notice, setNotice] = useState('');
  const [removalPrompt, setRemovalPrompt] = useState<WestronFriend | null>(null);
  const [outgoingRequestPrompt, setOutgoingRequestPrompt] = useState<WestronFriendRequest | null>(null);
  const [recallPrompt, setRecallPrompt] = useState<RecallPrompt | null>(null);
  const [groupMemberRemovalPrompt, setGroupMemberRemovalPrompt] = useState<{
    group: WestronFriendGroup;
    member: WestronFriendGroup['members'][number];
  } | null>(null);
  const [expandedPhoto, setExpandedPhoto] = useState('');
  const [voiceSettingsPageOpen, setVoiceSettingsPageOpen] = useState(false);
  const [microphoneTestRunning, setMicrophoneTestRunning] = useState(false);
  const [callFriendSkinUrl, setCallFriendSkinUrl] = useState('');
  const [selfCallSkinUrl, setSelfCallSkinUrl] = useState('');
  const [groupRemoteStreams, setGroupRemoteStreams] = useState<Record<string, MediaStream>>({});
  const [groupSpeakingUsers, setGroupSpeakingUsers] = useState<Set<string>>(new Set());
  const [groupCallSkinUrls, setGroupCallSkinUrls] = useState<Record<string, string>>({});
  const [microphones, setMicrophones] = useState<MediaDeviceInfo[]>([]);
  const [speakers, setSpeakers] = useState<MediaDeviceInfo[]>([]);
  const [microphoneId, setMicrophoneId] = useState(localStorage.getItem('westron-microphone') ?? '');
  const [speakerId, setSpeakerId] = useState(localStorage.getItem('westron-speaker') ?? '');
  const [microphoneVolume, setMicrophoneVolume] = useState(Number(localStorage.getItem('westron-microphone-volume') ?? '100'));
  const [noiseSuppressionEnabled, setNoiseSuppressionEnabled] = useState(
    localStorage.getItem('westron-noise-suppression') !== 'false',
  );
  const [speakerVolume, setSpeakerVolume] = useState(Number(localStorage.getItem('westron-speaker-volume') ?? '100'));
  const [inGameOverlay, setInGameOverlay] = useState(localStorage.getItem('westron-in-game-overlay') !== 'false');
  const [callAvatarShape, setCallAvatarShape] = useState<'round' | 'square'>(
    localStorage.getItem('westron-call-avatar-shape') === 'square' ? 'square' : 'round',
  );
  const [photoMenuOpen, setPhotoMenuOpen] = useState(false);
  const photoPickerRef = useRef<HTMLDivElement>(null);
  const friendsPageWasActiveRef = useRef(isActive);
  const pendingFriendNavigationRef = useRef('');
  const peerRef = useRef<RTCPeerConnection | null>(null);
  const groupPeersRef = useRef(new Map<string, RTCPeerConnection>());
  const localStreamRef = useRef<MediaStream | null>(null);
  const localProcessedStreamRef = useRef<MediaStream | null>(null);
  const localAudioContextRef = useRef<AudioContext | null>(null);
  const localGainNodeRef = useRef<GainNode | null>(null);
  const pendingLocalIceCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const localIceSignalContextRef = useRef(new Map<string, {
    recipientUserId: string;
    ready: boolean;
    groupId?: string;
  }>());
  const localIceSendQueuesRef = useRef(new Map<string, Promise<void>>());
  const pendingRemoteIceCandidatesRef = useRef(new Map<string, RTCIceCandidateInit[]>());
  const pendingGroupOffersRef = useRef<WestronCallSignal[]>([]);
  const remoteSpeakingContextRef = useRef<AudioContext | null>(null);
  const remoteSpeakingAnalyserRef = useRef<AnalyserNode | null>(null);
  const remoteSpeakingSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const remoteSpeakingFrameRef = useRef<number | null>(null);
  const localSpeakingAnalyserRef = useRef<AnalyserNode | null>(null);
  const localSpeakingFrameRef = useRef<number | null>(null);
  const microphoneTestStreamRef = useRef<MediaStream | null>(null);
  const microphoneTestOutputStreamRef = useRef<MediaStream | null>(null);
  const microphoneTestAudioContextRef = useRef<AudioContext | null>(null);
  const microphoneTestGainNodeRef = useRef<GainNode | null>(null);
  const microphoneTestAudioRef = useRef<HTMLAudioElement>(null);
  const microphoneTestRestoreMuteRef = useRef<boolean | null>(null);
  const activeCallRef = useRef<ActiveCall | null>(null);
  const incomingCallRef = useRef<IncomingCall | null>(null);
  const restoreVoiceCallWindowAfterAddRef = useRef(false);
  const signalPollBusyRef = useRef(false);
  const knownGroupMessageIdsRef = useRef(new Map<string, Set<string>>());
  const callTimeoutRef = useRef<number | null>(null);
  const callSetupControllerRef = useRef<AbortController | null>(null);
  const microphoneMutedRef = useRef(false);
  const remoteAudioMutedRef = useRef(false);
  const peerMediaChannelsRef = useRef(new Map<string, RTCDataChannel>());
  const remoteAudioRef = useRef<HTMLAudioElement>(null);
  const knownIncomingRequestIdsRef = useRef<Set<string> | null>(null);
  const knownIncomingMessageIdsRef = useRef<Set<string> | null>(null);
  const messagePollBusyRef = useRef(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const selectedFriend = friendList.friends.find((friend) => friend.userId === selectedFriendId) ?? null;
  const selectedGroup = groups.find((group) => group.id === selectedGroupId) ?? null;
  const callFriendUserId = activeCall?.friendUserId ?? incomingCall?.fromUserId;
  const callFriend = friendList.friends.find((friend) => friend.userId === callFriendUserId);
  const callGroupMembers = activeCall?.groupMembers
    ?? groups.find((group) => group.id === incomingCall?.groupId)?.members
    ?? EMPTY_GROUP_MEMBERS;
  const callUsername = activeCall?.groupName ?? incomingCall?.groupName
    ?? activeCall?.friendUsername ?? incomingCall?.fromUsername ?? '';
  const callStatusText = incomingCall
    ? incomingCall.groupId ? 'Gelen grup araması' : 'Gelen sesli arama'
    : activeCall?.status === 'active'
      ? activeCall.groupId ? 'Grup sesli sohbeti sürüyor' : 'Sesli arama sürüyor'
      : 'Bağlanıyor…';
  const latestConversationMessageId = selectedGroup
    ? groupConversation[groupConversation.length - 1]?.messageId
    : conversation[conversation.length - 1]?.messageId;

  useEffect(() => {
    if (!selectedGroup && !selectedFriend) return undefined;
    const frame = window.requestAnimationFrame(() => {
      if (conversationRef.current) {
        conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [selectedGroupId, selectedFriendId, latestConversationMessageId]);

  useEffect(() => {
    let active = true;
    if (!account?.username) {
      setSelfCallSkinUrl('');
      return () => { active = false; };
    }
    void getFriendSkinUrl(account.username)
      .then((url) => { if (active) setSelfCallSkinUrl(url ?? ''); })
      .catch(reportApiError);
    return () => { active = false; };
  }, [account?.username]);

  function setCurrentCall(call: ActiveCall | null) {
    activeCallRef.current = call;
    setActiveCall(call);
  }

  function setIncoming(call: IncomingCall | null) {
    incomingCallRef.current = call;
    setIncomingCall(call);
  }

  function isCurrentCall(callId: string) {
    return activeCallRef.current?.callId === callId;
  }

  function stopRemoteSpeakingMonitor() {
    if (remoteSpeakingFrameRef.current !== null) {
      window.cancelAnimationFrame(remoteSpeakingFrameRef.current);
      remoteSpeakingFrameRef.current = null;
    }
    remoteSpeakingSourceRef.current?.disconnect();
    remoteSpeakingSourceRef.current = null;
    remoteSpeakingAnalyserRef.current = null;
    const context = remoteSpeakingContextRef.current;
    remoteSpeakingContextRef.current = null;
    if (context && context.state !== 'closed') void context.close();
    setRemoteSpeaking(false);
  }

  function stopLocalSpeakingMonitor() {
    if (localSpeakingFrameRef.current !== null) {
      window.cancelAnimationFrame(localSpeakingFrameRef.current);
      localSpeakingFrameRef.current = null;
    }
    localSpeakingAnalyserRef.current = null;
    setSelfSpeaking(false);
  }

  function monitorLocalSpeaking(analyser: AnalyserNode) {
    localSpeakingAnalyserRef.current = analyser;
    const samples = new Uint8Array(analyser.fftSize);
    const detect = () => {
      if (localSpeakingAnalyserRef.current !== analyser) return;
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) {
        const amplitude = (sample - 128) / 128;
        energy += amplitude * amplitude;
      }
      const speaking = !microphoneMutedRef.current && Math.sqrt(energy / samples.length) > 0.025;
      setSelfSpeaking((previous) => previous === speaking ? previous : speaking);
      localSpeakingFrameRef.current = window.requestAnimationFrame(detect);
    };
    detect();
  }

  function monitorRemoteSpeaking(stream: MediaStream) {
    stopRemoteSpeakingMonitor();
    try {
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      remoteSpeakingContextRef.current = context;
      remoteSpeakingAnalyserRef.current = analyser;
      remoteSpeakingSourceRef.current = source;
      const samples = new Uint8Array(analyser.fftSize);
      const detect = () => {
        if (remoteSpeakingAnalyserRef.current !== analyser) return;
        analyser.getByteTimeDomainData(samples);
        let energy = 0;
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128;
          energy += amplitude * amplitude;
        }
        const speaking = Math.sqrt(energy / samples.length) > 0.025;
        setRemoteSpeaking((previous) => previous === speaking ? previous : speaking);
        remoteSpeakingFrameRef.current = window.requestAnimationFrame(detect);
      };
      void context.resume().catch((reason: unknown) => setError(errorMessage(reason)));
      detect();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  }

  function stopMicrophoneTest() {
    microphoneTestStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneTestStreamRef.current = null;
    microphoneTestOutputStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneTestOutputStreamRef.current = null;
    microphoneTestGainNodeRef.current?.disconnect();
    microphoneTestGainNodeRef.current = null;
    const testContext = microphoneTestAudioContextRef.current;
    microphoneTestAudioContextRef.current = null;
    if (testContext && testContext.state !== 'closed') void testContext.close();
    if (microphoneTestAudioRef.current) microphoneTestAudioRef.current.srcObject = null;
    setMicrophoneTestRunning(false);
    const previousMuteState = microphoneTestRestoreMuteRef.current;
    microphoneTestRestoreMuteRef.current = null;
    if (previousMuteState === null) return;
    microphoneMutedRef.current = previousMuteState;
    setMicrophoneMuted(previousMuteState);
    localStreamRef.current?.getAudioTracks().forEach((track) => {
      track.enabled = !previousMuteState;
    });
  }

  async function toggleMicrophoneTest() {
    if (microphoneTestRunning) {
      stopMicrophoneTest();
      return;
    }
    setBusy('microphone-test');
    try {
      const currentTrack = localStreamRef.current?.getAudioTracks()[0];
      let testStream: MediaStream;
      if (currentTrack) {
        const testTrack = currentTrack.clone();
        testTrack.enabled = true;
        testStream = new MediaStream([testTrack]);
      } else {
        testStream = await captureMicrophoneStream({
          deviceId: microphoneId ? { ideal: microphoneId } : undefined,
          echoCancellation: { ideal: true },
          noiseSuppression: noiseSuppressionEnabled,
          autoGainControl: { ideal: true },
          channelCount: { ideal: 1 },
          sampleRate: { ideal: 48_000 },
        });
      }
      microphoneTestStreamRef.current = testStream;
      const context = new AudioContext();
      const source = context.createMediaStreamSource(testStream);
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      gain.gain.value = microphoneVolume / 100;
      source.connect(gain);
      gain.connect(destination);
      microphoneTestAudioContextRef.current = context;
      microphoneTestGainNodeRef.current = gain;
      microphoneTestOutputStreamRef.current = destination.stream;
      await context.resume();
      const wasMuted = microphoneMutedRef.current;
      microphoneTestRestoreMuteRef.current = wasMuted;
      if (localStreamRef.current) {
        microphoneMutedRef.current = true;
        setMicrophoneMuted(true);
        localStreamRef.current.getAudioTracks().forEach((track) => { track.enabled = false; });
      }
      const audio = microphoneTestAudioRef.current;
      if (!audio) throw new Error('Mikrofon testi başlatılamadı.');
      audio.srcObject = destination.stream;
      audio.volume = speakerVolume / 100;
      if (speakerId) {
        const output = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
        await output.setSinkId?.(speakerId);
      }
      await audio.play();
      setMicrophoneTestRunning(true);
    } catch (reason) {
      stopMicrophoneTest();
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  function clearCallSignalState(callId: string) {
    for (const map of [
      localIceSignalContextRef.current,
      pendingLocalIceCandidatesRef.current,
      localIceSendQueuesRef.current,
      pendingRemoteIceCandidatesRef.current,
    ]) {
      for (const key of map.keys()) {
        if (key === callId || key.startsWith(`${callId}:`)) map.delete(key);
      }
    }
  }

  function sendLocalMediaState() {
    const state = JSON.stringify({
      microphoneMuted: microphoneMutedRef.current,
      speakerMuted: remoteAudioMutedRef.current,
    });
    for (const channel of peerMediaChannelsRef.current.values()) {
      if (channel.readyState === 'open') channel.send(state);
    }
  }

  function attachPeerMediaChannel(channel: RTCDataChannel, userId: string) {
    peerMediaChannelsRef.current.set(userId, channel);
    channel.addEventListener('open', sendLocalMediaState);
    channel.addEventListener('message', (event) => {
      if (typeof event.data !== 'string') return;
      try {
        const state = JSON.parse(event.data) as Partial<PeerMediaState>;
        const microphoneMuted = state.microphoneMuted;
        const speakerMuted = state.speakerMuted;
        if (typeof microphoneMuted !== 'boolean' || typeof speakerMuted !== 'boolean') return;
        setPeerMediaStates((current) => ({
          ...current,
          [userId]: {
            microphoneMuted,
            speakerMuted,
          },
        }));
      } catch {
        return;
      }
    });
    channel.addEventListener('close', () => {
      if (peerMediaChannelsRef.current.get(userId) === channel) {
        peerMediaChannelsRef.current.delete(userId);
        setPeerMediaStates((current) => {
          if (!current[userId]) return current;
          const next = { ...current };
          delete next[userId];
          return next;
        });
      }
    });
    if (channel.readyState === 'open') sendLocalMediaState();
  }

  function resetPeersForCallUpgrade(callId: string) {
    clearCallSignalState(callId);
    peerRef.current?.close();
    peerRef.current = null;
    for (const peer of groupPeersRef.current.values()) peer.close();
    groupPeersRef.current.clear();
    for (const channel of peerMediaChannelsRef.current.values()) channel.close();
    peerMediaChannelsRef.current.clear();
    pendingGroupOffersRef.current = [];
    setPeerMediaStates({});
    setGroupRemoteStreams({});
    setGroupSpeakingUsers(new Set());
    stopRemoteSpeakingMonitor();
    setRemoteSpeaking(false);
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
  }

  function closePeerConnection() {
    const activeCall = activeCallRef.current;
    const incomingCall = incomingCallRef.current;
    if (activeCall) onDismissNotification(getCallNotificationId(activeCall.callId, activeCall.groupId));
    if (incomingCall) onDismissNotification(getCallNotificationId(incomingCall.callId, incomingCall.groupId));
    const callIds = [
      activeCall?.callId,
      incomingCall?.callId,
    ].filter((callId): callId is string => Boolean(callId));
    for (const callId of callIds) clearCallSignalState(callId);
    callSetupControllerRef.current?.abort();
    callSetupControllerRef.current = null;
    if (callTimeoutRef.current !== null) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    peerRef.current?.close();
    peerRef.current = null;
    for (const peer of groupPeersRef.current.values()) peer.close();
    groupPeersRef.current.clear();
    for (const channel of peerMediaChannelsRef.current.values()) channel.close();
    peerMediaChannelsRef.current.clear();
    pendingGroupOffersRef.current = [];
    setPeerMediaStates({});
    setAddCallParticipantOpen(false);
    setCallParticipantId('');
    restoreVoiceCallWindowAfterAddRef.current = false;
    setGroupRemoteStreams({});
    setGroupSpeakingUsers(new Set());
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    localStreamRef.current = null;
    localProcessedStreamRef.current?.getTracks().forEach((track) => track.stop());
    localProcessedStreamRef.current = null;
    stopLocalSpeakingMonitor();
    localGainNodeRef.current?.disconnect();
    localGainNodeRef.current = null;
    const localAudioContext = localAudioContextRef.current;
    localAudioContextRef.current = null;
    if (localAudioContext && localAudioContext.state !== 'closed') void localAudioContext.close();
    stopRemoteSpeakingMonitor();
    if (remoteAudioRef.current) remoteAudioRef.current.srcObject = null;
    microphoneMutedRef.current = false;
    remoteAudioMutedRef.current = false;
    setMicrophoneMuted(false);
    setRemoteAudioMuted(false);
    setCurrentCall(null);
    setIncoming(null);
  }

  function callSignalKey(callId: string, remoteUserId?: string) {
    return remoteUserId ? `${callId}:${remoteUserId}` : callId;
  }

  function sendLocalIceCandidate(
    callId: string,
    candidate: RTCIceCandidateInit,
    groupId?: string,
    remoteUserId?: string,
  ) {
    const key = callSignalKey(callId, remoteUserId);
    const context = localIceSignalContextRef.current.get(key);
    if (!context?.ready) {
      const candidates = pendingLocalIceCandidatesRef.current.get(key) ?? [];
      candidates.push(candidate);
      pendingLocalIceCandidatesRef.current.set(key, candidates);
      return Promise.resolve();
    }
    const previous = localIceSendQueuesRef.current.get(key) ?? Promise.resolve();
    const next = previous.then(() => window.nocturne.sendWestronVoiceCallSignal({
      recipientUserId: context.recipientUserId,
      ...(groupId && { groupId }),
      callId,
      type: 'candidate',
      sdp: JSON.stringify(candidate),
    })).then(() => undefined).catch((reason: unknown) => {
      reportApiError(reason);
    });
    localIceSendQueuesRef.current.set(key, next);
    return next;
  }

  async function signalPendingLocalIceCandidates(callId: string, groupId?: string, remoteUserId?: string) {
    const key = callSignalKey(callId, remoteUserId);
    const context = localIceSignalContextRef.current.get(key);
    if (!context) return;
    context.ready = true;
    const candidates = pendingLocalIceCandidatesRef.current.get(key) ?? [];
    pendingLocalIceCandidatesRef.current.delete(key);
    for (const candidate of candidates) await sendLocalIceCandidate(callId, candidate, groupId, remoteUserId);
  }

  async function addPendingRemoteIceCandidates(callId: string, peer: RTCPeerConnection, remoteUserId?: string) {
    const key = callSignalKey(callId, remoteUserId);
    const candidates = pendingRemoteIceCandidatesRef.current.get(key) ?? [];
    pendingRemoteIceCandidatesRef.current.delete(key);
    for (const candidate of candidates) await peer.addIceCandidate(candidate);
  }

  function setNoiseSuppression(enabled: boolean) {
    setNoiseSuppressionEnabled(enabled);
    localStorage.setItem('westron-noise-suppression', String(enabled));
    const tracks = localStreamRef.current?.getAudioTracks() ?? [];
    void Promise.all(tracks.map((track) => applyNoiseSuppressionConstraint(track, enabled)))
      .catch((reason: unknown) => setError(errorMessage(reason)));
  }

  function reportApiError(reason: unknown) {
    if (isMissingFriendsApi(reason)) {
      setApiUnavailable(true);
      setError('');
      setPresenceError('');
      return;
    }
    setError(errorMessage(reason));
    setPresenceError('');
  }

  function notifyIncoming(notification: FriendsNotification) {
    onNotification(notification);
    if (notification.kind !== 'call') {
      playSocialSound(notification.kind === 'photo' ? 'photo' : 'message');
    }
    void window.nocturne.showWestronNotification({
      sender: notification.sender,
      message: notification.message,
      notificationId: notification.kind === 'call' ? undefined : notification.id,
    }).catch((reason: unknown) => {
      setError(errorMessage(reason));
    });
  }

  function makeIncomingCallNotification(call: IncomingCall): FriendsNotification {
    return {
      id: getCallNotificationId(call.callId, call.groupId),
      kind: 'call',
      sender: call.fromUsername,
      message: text(call.groupId ? 'Gelen grup araması' : 'Gelen sesli arama'),
      actions: [
        {
          label: text('Kabul et'),
          icon: 'phone',
          variant: 'primary',
          dismissOnClick: false,
          onClick: () => {
            onOpenFriends();
            void acceptIncomingCall();
          },
        },
        {
          label: text('Reddet'),
          icon: 'phone-off',
          variant: 'danger',
          onClick: () => { void rejectIncomingCall(); },
        },
      ],
    };
  }

  function retainCallNotification(call: IncomingCall) {
    onNotification({
      id: getCallNotificationId(call.callId, call.groupId),
      kind: 'call',
      sender: call.fromUsername,
      message: text(call.groupId ? 'Grup sesli sohbeti sürüyor' : 'Sesli arama sürüyor'),
      actions: [{
        label: text('Aramayı aç'),
        icon: 'phone',
        dismissOnClick: false,
        onClick: () => {
          void window.nocturne.showWestronVoiceCallWindow()
            .catch((reason: unknown) => setError(errorMessage(reason)));
        },
      }],
    });
  }

  function scheduleIncomingCallTimeout(call: IncomingCall) {
    if (callTimeoutRef.current !== null) window.clearTimeout(callTimeoutRef.current);
    callTimeoutRef.current = window.setTimeout(() => {
      callTimeoutRef.current = null;
      if (incomingCallRef.current?.callId === call.callId) void rejectIncomingCall();
    }, 60_000);
  }

  useEffect(() => {
    if (isActive && !friendsPageWasActiveRef.current) {
      setSelectedFriendId(
        activeCallRef.current?.friendUserId
          ?? incomingCallRef.current?.fromUserId
          ?? pendingFriendNavigationRef.current,
      );
      pendingFriendNavigationRef.current = '';
      setSelectedGroupId('');
      setConversation([]);
      setGroupConversation([]);
      setUsername('');
      setFriendSuggestions([]);
      setFriendSearchFocused(false);
      setFriendQuery('');
      setPhotoMenuOpen(false);
      setGroupModalOpen(false);
      setGroupSettingsOpen(false);
      setGroupDeletePrompt(null);
      setGroupDeleteName('');
      setGroupDeletePhase('confirm');
      setRecallPrompt(null);
      setRemovalPrompt(null);
      setOutgoingRequestPrompt(null);
      setGroupMemberRemovalPrompt(null);
      setNotice('');
      setError('');
      setVoiceSettingsPageOpen(false);
    }
    friendsPageWasActiveRef.current = isActive;
  }, [isActive]);

  useEffect(() => {
    if (!isActive) return;
    if (sessionStorage.getItem('westron-open-voice-settings') === 'true') {
      setVoiceSettingsPageOpen(true);
      sessionStorage.removeItem('westron-open-voice-settings');
    }
  }, [isActive]);

  useEffect(() => {
    if (!photoMenuOpen) return undefined;
    const closeOnOutsideClick = (event: PointerEvent) => {
      if (event.target instanceof Node && !photoPickerRef.current?.contains(event.target)) {
        setPhotoMenuOpen(false);
      }
    };
    document.addEventListener('pointerdown', closeOnOutsideClick);
    return () => document.removeEventListener('pointerdown', closeOnOutsideClick);
  }, [photoMenuOpen]);

  useEffect(() => {
    if (!isActive || !account?.emailVerified || apiUnavailable) return;
    void window.nocturne.listWestronGroups()
      .then(setGroups)
      .catch(reportApiError);
  }, [account?.emailVerified, apiUnavailable, isActive]);

  useEffect(() => {
    if (!isActive || !friendSearchFocused || !account?.emailVerified || apiUnavailable) {
      setFriendSuggestions([]);
      return;
    }
    const query = username.trim();
    let active = true;
    const timeout = window.setTimeout(() => {
      void window.nocturne.searchWestronFriends({ query })
        .then((suggestions) => {
          if (active) setFriendSuggestions(suggestions);
        })
        .catch((reason) => {
          if (!active) return;
          setFriendSuggestions([]);
          reportApiError(reason);
        });
    }, 180);
    return () => {
      active = false;
      window.clearTimeout(timeout);
    };
  }, [username, friendSearchFocused, account?.emailVerified, apiUnavailable, isActive]);

  useEffect(() => {
    if (!callUsername) {
      setCallFriendSkinUrl('');
      return;
    }
    let active = true;
    void getFriendSkinUrl(callUsername, callFriend?.minecraftUsername)
      .then((url) => {
        if (active) setCallFriendSkinUrl(url ?? '');
      })
      .catch((reason) => {
        if (active) reportApiError(reason);
      });
    return () => { active = false; };
  }, [callUsername, callFriend?.minecraftUsername]);

  useEffect(() => {
    let active = true;
    const members = callGroupMembers.filter((member) => member.username.toLowerCase() !== account?.username.toLowerCase());
    if (!members.length) {
      setGroupCallSkinUrls({});
      return () => { active = false; };
    }
    void Promise.all(members.map(async (member) => [
      member.userId,
      await getFriendSkinUrl(member.username, member.minecraftUsername),
    ] as const))
      .then((entries) => {
        if (active) setGroupCallSkinUrls(Object.fromEntries(entries.filter((entry): entry is readonly [string, string] => Boolean(entry[1]))));
      })
      .catch(reportApiError);
    return () => { active = false; };
  }, [callGroupMembers, account?.username]);

  useEffect(() => {
    document.documentElement.dataset.callAvatarShape = callAvatarShape;
  }, [callAvatarShape]);

  useEffect(() => {
    if (!window.nocturne) return;
    const participants = activeCall
      ? activeCall.groupId
        ? [account?.username ?? '', ...Object.keys(groupRemoteStreams)
          .map((userId) => activeCall.groupMembers?.find((member) => member.userId === userId)?.username ?? '')].filter(Boolean)
        : [account?.username ?? '', activeCall.friendUsername].filter(Boolean)
      : [];
    void window.nocturne.updateWestronVoiceOverlay({
      enabled: inGameOverlay,
      participants,
      speaking: activeCall?.groupId
        ? [...groupSpeakingUsers].map((userId) =>
          activeCall.groupMembers?.find((member) => member.userId === userId)?.username ?? '').filter(Boolean)
        : activeCall?.status === 'active' && remoteSpeaking ? [activeCall.friendUsername] : [],
      call: activeCall ? {
        incoming: false,
        self: account?.username ?? '',
        selfSkinUrl: selfCallSkinUrl,
        selfSpeaking,
        friend: activeCall.groupName ?? activeCall.friendUsername,
        status: text(callStatusText),
        avatarShape: callAvatarShape,
        microphoneMuted,
        remoteAudioMuted,
        friendMicrophoneMuted: peerMediaStates[activeCall.friendUserId]?.microphoneMuted ?? false,
        friendSpeakerMuted: peerMediaStates[activeCall.friendUserId]?.speakerMuted ?? false,
        canAddParticipant: !activeCall.groupId && activeCall.status === 'active',
        friendSkinUrl: callFriendSkinUrl,
        groupParticipants: callGroupMembers
          .filter((member) => member.username.toLowerCase() !== account?.username.toLowerCase())
          .map((member) => ({
            username: member.username,
            skinUrl: groupCallSkinUrls[member.userId] ?? '',
            connected: Boolean(groupRemoteStreams[member.userId]),
            speaking: groupSpeakingUsers.has(member.userId),
            microphoneMuted: peerMediaStates[member.userId]?.microphoneMuted ?? false,
            speakerMuted: peerMediaStates[member.userId]?.speakerMuted ?? false,
          })),
        labels: {
          microphone: text('Mikrofon'),
          speaker: text('Hoparlör'),
          addParticipant: text('Katılımcı ekle'),
          microphoneMuted: text('Mikrofon kapalı'),
          speakerMuted: text('Hoparlör kapalı'),
          end: text('Aramayı bitir'),
          accept: text('Kabul et'),
          reject: text('Reddet'),
          minimize: text('Pencereyi küçült'),
          showMain: text('Pencereyi büyüt veya geri yükle'),
          self: text('Sen'),
          connected: text('Bağlandı'),
          connecting: text('Bağlanıyor…'),
        },
      } : undefined,
    }).then(() => {
      if (!restoreVoiceCallWindowAfterAddRef.current) return;
      restoreVoiceCallWindowAfterAddRef.current = false;
      if (!activeCallRef.current) return;
      return window.nocturne.showWestronVoiceCallWindow();
    }).catch((reason: unknown) => setError(errorMessage(reason)));
  }, [
    inGameOverlay,
    activeCall?.callId,
    activeCall?.status,
    activeCall?.friendUsername,
    activeCall?.groupId,
    activeCall?.groupName,
    activeCall?.groupMembers,
    incomingCall?.callId,
    incomingCall?.fromUsername,
    incomingCall?.groupId,
    incomingCall?.groupName,
    account?.username,
    microphoneMuted,
    remoteAudioMuted,
    selfSpeaking,
    peerMediaStates,
    callFriendUserId,
    remoteSpeaking,
    groupRemoteStreams,
    groupSpeakingUsers,
    groupCallSkinUrls,
    callGroupMembers,
    callFriendSkinUrl,
    selfCallSkinUrl,
    callAvatarShape,
    callStatusText,
    language,
  ]);

  useEffect(() => {
    const removeActionListener = window.nocturne.onVoiceCallAction((action) => {
      if (action === 'accept') void acceptIncomingCall();
      else if (action === 'reject') void rejectIncomingCall();
      else if (action === 'end') {
        if (activeCallRef.current) void endVoiceCall();
        else void rejectIncomingCall();
      } else if (action === 'toggle-microphone') toggleMicrophone();
      else if (action === 'toggle-speaker') toggleRemoteAudio();
      else if (action === 'add-participant') {
        const call = activeCallRef.current;
        if (call && !call.groupId && call.status === 'active') {
          restoreVoiceCallWindowAfterAddRef.current = true;
          onOpenFriends();
          setCallParticipantId('');
          setAddCallParticipantOpen(true);
        }
      }
    });
    const removeWindowStateListener = window.nocturne.onVoiceCallWindowState((state) => {
      setVoiceCallWindowVisible(state.visible || state.opening);
    });
    return () => {
      removeActionListener();
      removeWindowStateListener();
    };
  }, []);

  useEffect(() => {
    if (!account?.emailVerified || apiUnavailable) {
      setPresenceError('');
      return undefined;
    }

    let active = true;
    const heartbeat = () => {
      void window.nocturne.updateWestronPresence({ inGame: gameRunning }).then(() => {
        if (active) setPresenceError('');
      }).catch((reason: unknown) => {
        if (!active) return;
        if (isMissingFriendsApi(reason)) {
          setApiUnavailable(true);
          setPresenceError('');
        }
        else setPresenceError(errorMessage(reason));
      });
    };
    heartbeat();
    const interval = window.setInterval(heartbeat, 20_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [account?.username, account?.emailVerified, gameRunning, apiUnavailable]);

  useEffect(() => {
    if (!account?.emailVerified) {
      setApiUnavailable(false);
      setFriendList(EMPTY_FRIENDS);
      knownIncomingRequestIdsRef.current = null;
      knownIncomingMessageIdsRef.current = null;
      setSelectedFriendId('');
      closePeerConnection();
      return undefined;
    }
    if (apiUnavailable) return undefined;

    let active = true;
    const refreshSocialState = async () => {
      try {
        const nextFriends = await window.nocturne.listWestronFriends();
        if (!active) return;
        const incomingRequestIds = new Set(nextFriends.incomingRequests.map((request) => request.requestId));
        const newlyReceived = knownIncomingRequestIdsRef.current
          ? nextFriends.incomingRequests.filter((request) =>
            !knownIncomingRequestIdsRef.current?.has(request.requestId))
          : nextFriends.incomingRequests;
        if (newlyReceived.length) {
          for (const request of newlyReceived) {
            notifyIncoming({
              id: `friend-request:${request.requestId}`,
              kind: 'friend-request',
              sender: request.username,
              message: text('Arkadaşlık isteği gönderdi.'),
              actions: [
                { label: text('Kabul et'), onClick: () => { void respondToRequest(request, true); } },
                { label: text('Reddet'), onClick: () => { void respondToRequest(request, false); } },
              ],
            });
          }
        }
        knownIncomingRequestIdsRef.current = incomingRequestIds;
        setFriendList(nextFriends);
        setError('');
      } catch (reason) {
        if (active) reportApiError(reason);
      }
    };
    const receiveMessages = async () => {
      if (messagePollBusyRef.current) return;
      messagePollBusyRef.current = true;
      try {
        const messages = await window.nocturne.listWestronEphemeralMessages();
        if (!active) return;
        const knownMessageIds = knownIncomingMessageIdsRef.current;
        const incoming = messages.filter((message) =>
          message.senderUserId !== '' && !knownMessageIds?.has(message.messageId));
        if (!knownMessageIds) {
          knownIncomingMessageIdsRef.current = new Set(messages.map((message) => message.messageId));
          return;
        }
        for (const message of incoming) {
          knownMessageIds.add(message.messageId);
          const isPhoto = message.kind === 'photo';
          notifyIncoming({
            id: `message:${message.messageId}`,
            kind: isPhoto ? 'photo' : 'message',
            sender: message.senderUsername,
            message: text(isPhoto ? 'Yeni fotoğraf' : 'Bir mesajınız var'),
            actions: [{
              label: text('Sohbete git'),
              onClick: () => {
                pendingFriendNavigationRef.current = isActive ? '' : message.senderUserId;
                setSelectedFriendId(message.senderUserId);
                setSelectedGroupId('');
                onOpenFriends();
              },
            }],
          });
        }
      } catch (reason) {
        if (active) reportApiError(reason);
      } finally {
        messagePollBusyRef.current = false;
      }
    };
    const receiveSignals = async () => {
      if (signalPollBusyRef.current) return;
      signalPollBusyRef.current = true;
      try {
        const signals = await window.nocturne.consumeWestronVoiceCallSignals();
        for (const signal of signals) {
          if (signal.type === 'candidate') {
            const candidate = JSON.parse(signal.sdp) as RTCIceCandidateInit;
            const peer = signal.groupId
              ? groupPeersRef.current.get(signal.fromUserId)
              : peerRef.current;
            const candidateKey = callSignalKey(signal.callId, signal.groupId ? signal.fromUserId : undefined);
            if (peer?.remoteDescription
              && activeCallRef.current?.callId === signal.callId
              && activeCallRef.current.groupId === (signal.groupId ?? undefined)) {
              await peer.addIceCandidate(candidate);
            } else {
              const candidates = pendingRemoteIceCandidatesRef.current.get(candidateKey) ?? [];
              candidates.push(candidate);
              pendingRemoteIceCandidatesRef.current.set(candidateKey, candidates);
            }
            continue;
          }
          if (signal.type === 'offer') {
            if (signal.groupId) {
              const currentCall = activeCallRef.current;
              if (currentCall?.groupId === signal.groupId && currentCall.callId === signal.callId) {
                await answerGroupPeerOffer(currentCall, signal);
                continue;
              }
              const currentIncoming = incomingCallRef.current;
              if (currentIncoming?.groupId === signal.groupId && currentIncoming.callId === signal.callId) {
                if (!pendingGroupOffersRef.current.some((item) => item.fromUserId === signal.fromUserId)) {
                  pendingGroupOffersRef.current.push(signal);
                }
                continue;
              }
              let group = groups.find((item) => item.id === signal.groupId);
              if (!group) {
                const refreshedGroups = await window.nocturne.listWestronGroups();
                setGroups(refreshedGroups);
                group = refreshedGroups.find((item) => item.id === signal.groupId);
              }
              const activeDirectCall = activeCallRef.current;
              const isCallUpgrade = Boolean(
                activeDirectCall
                && !activeDirectCall.groupId
                && activeDirectCall.status === 'active'
                && activeDirectCall.friendUserId === signal.fromUserId
                && group !== undefined
                && group.ownerUserId === signal.fromUserId
                && group.name.startsWith(TEMPORARY_CALL_GROUP_PREFIX)
                && group.members.some((member) => member.username.toLowerCase() === account?.username.toLowerCase())
                && group.members.length <= 6,
              );
              if (isCallUpgrade && group && activeDirectCall) {
                const ownUserId = group.members.find((member) => member.username.toLowerCase() === account?.username.toLowerCase())?.userId;
                if (!ownUserId) {
                  throw new Error('Geçici arama odasındaki üyeliğiniz doğrulanamadı.');
                }
                resetPeersForCallUpgrade(activeDirectCall.callId);
                const call: ActiveCall = {
                  callId: signal.callId,
                  friendUserId: signal.fromUserId,
                  friendUsername: group.name,
                  groupId: group.id,
                  groupName: group.name,
                  groupMembers: group.members,
                  status: 'connecting',
                  temporaryGroup: true,
                  temporaryGroupOwnerUserId: group.ownerUserId,
                };
                setCurrentCall(call);
                await answerGroupPeerOffer(call, signal);
                for (const member of group.members) {
                  if (member.userId !== signal.fromUserId && ownUserId < member.userId) {
                    await startGroupPeerOffer(call, member);
                  }
                }
                continue;
              }
              if (activeCallRef.current || incomingCallRef.current || !group || group.members.length > 6) {
                await window.nocturne.sendWestronVoiceCallSignal({
                  recipientUserId: signal.fromUserId,
                  groupId: signal.groupId,
                  callId: signal.callId,
                  type: 'reject',
                  sdp: '',
                });
                continue;
              }
              const incoming: IncomingCall = {
                callId: signal.callId,
                fromUserId: signal.fromUserId,
                fromUsername: signal.fromUsername,
                sdp: signal.sdp,
                groupId: signal.groupId,
                groupName: group.name,
              };
              setIncoming(incoming);
              scheduleIncomingCallTimeout(incoming);
              setSelectedFriendId('');
              setSelectedGroupId(group.id);
              notifyIncoming(makeIncomingCallNotification(incoming));
              continue;
            }
            if (activeCallRef.current || incomingCallRef.current) {
              await window.nocturne.sendWestronVoiceCallSignal({
                recipientUserId: signal.fromUserId,
                callId: signal.callId,
                type: 'reject',
                sdp: '',
              });
            } else {
              const incoming = {
                callId: signal.callId,
                fromUserId: signal.fromUserId,
                fromUsername: signal.fromUsername,
                sdp: signal.sdp,
              };
              setIncoming(incoming);
              scheduleIncomingCallTimeout(incoming);
              setSelectedFriendId(signal.fromUserId);
              setSelectedGroupId('');
              notifyIncoming(makeIncomingCallNotification(incoming));
            }
            continue;
          }

          const currentCall = activeCallRef.current;
          if (signal.groupId
            && currentCall?.groupId === signal.groupId
            && currentCall.callId === signal.callId
            && signal.type === 'answer') {
            const peer = groupPeersRef.current.get(signal.fromUserId);
            if (!peer) continue;
            if (callTimeoutRef.current !== null) {
              window.clearTimeout(callTimeoutRef.current);
              callTimeoutRef.current = null;
            }
            await peer.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
            await addPendingRemoteIceCandidates(signal.callId, peer, signal.fromUserId);
            setCurrentCall({ ...currentCall, status: 'connecting' });
          } else if (currentCall?.callId === signal.callId
            && !signal.groupId && signal.type === 'answer' && peerRef.current) {
            if (callTimeoutRef.current !== null) {
              window.clearTimeout(callTimeoutRef.current);
              callTimeoutRef.current = null;
            }
            await peerRef.current.setRemoteDescription({ type: 'answer', sdp: signal.sdp });
            await addPendingRemoteIceCandidates(signal.callId, peerRef.current);
            setCurrentCall({ ...currentCall, status: 'connecting' });
          } else if (signal.groupId
            && currentCall?.groupId === signal.groupId
            && currentCall.callId === signal.callId
            && (signal.type === 'hangup' || signal.type === 'reject')) {
            if (currentCall.temporaryGroup
              && signal.type === 'hangup'
              && signal.fromUserId === currentCall.temporaryGroupOwnerUserId) {
              const endedGroupId = currentCall.groupId;
              closePeerConnection();
              setSelectedGroupId((selectedId) => selectedId === endedGroupId ? '' : selectedId);
              setGroups(await window.nocturne.listWestronGroups());
              continue;
            }
            const peer = groupPeersRef.current.get(signal.fromUserId);
            peer?.close();
            groupPeersRef.current.delete(signal.fromUserId);
            setGroupRemoteStreams((streams) => {
              const next = { ...streams };
              delete next[signal.fromUserId];
              return next;
            });
            if (!groupPeersRef.current.size) closePeerConnection();
          } else if (signal.groupId
            && incomingCallRef.current?.groupId === signal.groupId
            && incomingCallRef.current.callId === signal.callId
            && incomingCallRef.current.fromUserId === signal.fromUserId
            && (signal.type === 'hangup' || signal.type === 'reject')) {
            closePeerConnection();
          } else if (currentCall?.callId === signal.callId
            && !signal.groupId
            && (signal.type === 'hangup' || signal.type === 'reject')) {
            closePeerConnection();
          } else if (incomingCallRef.current?.callId === signal.callId
            && !signal.groupId
            && (signal.type === 'hangup' || signal.type === 'reject')) {
            closePeerConnection();
          }
        }
      } catch (reason) {
        if (active) reportApiError(reason);
      } finally {
        signalPollBusyRef.current = false;
      }
    };

    void refreshSocialState();
    void receiveMessages();
    if (isActive) void receiveSignals();
    const socialInterval = window.setInterval(() => void refreshSocialState(), 15_000);
    const messageInterval = window.setInterval(() => void receiveMessages(), 8_000);
    const signalInterval = window.setInterval(() => {
      void receiveSignals();
    }, 5_000);

    return () => {
      active = false;
      window.clearInterval(socialInterval);
      window.clearInterval(messageInterval);
      window.clearInterval(signalInterval);
    };
  }, [account?.username, account?.emailVerified, isActive, language, apiUnavailable]);

  useEffect(() => () => {
    peerRef.current?.close();
    localStreamRef.current?.getTracks().forEach((track) => track.stop());
    microphoneTestStreamRef.current?.getTracks().forEach((track) => track.stop());
    if (localSpeakingFrameRef.current !== null) {
      window.cancelAnimationFrame(localSpeakingFrameRef.current);
      localSpeakingFrameRef.current = null;
    }
    localSpeakingAnalyserRef.current = null;
    if (localAudioContextRef.current && localAudioContextRef.current.state !== 'closed') {
      void localAudioContextRef.current.close();
    }
    if (remoteSpeakingFrameRef.current !== null) {
      window.cancelAnimationFrame(remoteSpeakingFrameRef.current);
    }
    remoteSpeakingSourceRef.current?.disconnect();
    if (remoteSpeakingContextRef.current && remoteSpeakingContextRef.current.state !== 'closed') {
      void remoteSpeakingContextRef.current.close();
    }
  }, []);

  useEffect(() => {
    if (!isActive || !selectedFriendId || !account?.emailVerified || apiUnavailable) {
      setConversation([]);
      return;
    }
    let active = true;
    const refreshConversation = () => {
      void window.nocturne.listWestronConversation({ friendUserId: selectedFriendId })
        .then((items) => {
          if (!active) return;
          setConversation(items);
          setError('');
        })
        .catch(reportApiError);
    };
    refreshConversation();
    const interval = window.setInterval(refreshConversation, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedFriendId, account?.emailVerified, apiUnavailable, isActive]);

  useEffect(() => {
    if (!isActive || !selectedGroupId || !account?.emailVerified || apiUnavailable) {
      setGroupConversation([]);
      return;
    }
    let active = true;
    const refreshGroupConversation = () => {
      void window.nocturne.listWestronGroupConversation({ groupId: selectedGroupId })
        .then((items) => {
          if (!active) return;
          const knownIds = knownGroupMessageIdsRef.current.get(selectedGroupId);
          if (knownIds) {
            const ownUserId = selectedGroup?.members.find((member) => member.username === account.username)?.userId;
            for (const message of items) {
              if (!knownIds.has(message.messageId) && message.senderUserId !== ownUserId) {
                playSocialSound(message.kind === 'photo' ? 'photo' : 'message');
              }
              knownIds.add(message.messageId);
            }
          } else {
            knownGroupMessageIdsRef.current.set(
              selectedGroupId,
              new Set(items.map((message) => message.messageId)),
            );
          }
          setGroupConversation(items);
          setError('');
        })
        .catch(reportApiError);
    };
    refreshGroupConversation();
    const interval = window.setInterval(refreshGroupConversation, 5_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [selectedGroupId, selectedGroup?.members, account?.username, account?.emailVerified, apiUnavailable, isActive]);

  useEffect(() => {
    if (!navigator.mediaDevices?.enumerateDevices) return undefined;
    const loadDevices = () => {
      void navigator.mediaDevices.enumerateDevices().then((devices) => {
        setMicrophones(devices.filter((device) => device.kind === 'audioinput'));
        setSpeakers(devices.filter((device) => device.kind === 'audiooutput'));
      }).catch(() => undefined);
    };
    loadDevices();
    navigator.mediaDevices.addEventListener('devicechange', loadDevices);
    return () => navigator.mediaDevices.removeEventListener('devicechange', loadDevices);
  }, []);

  useEffect(() => {
    const audio = remoteAudioRef.current;
    if (!audio) return;
    audio.volume = speakerVolume / 100;
    audio.muted = remoteAudioMuted;
    if (!speakerId) return;
    const sinkAudio = audio as HTMLAudioElement & { setSinkId?: (deviceId: string) => Promise<void> };
    void sinkAudio.setSinkId?.(speakerId).catch(() => undefined);
  }, [speakerId, speakerVolume, remoteAudioMuted, activeCall?.callId]);

  useEffect(() => {
    if (!incomingCall && activeCall?.status !== 'calling') return undefined;
    playSocialSound('call');
    const interval = window.setInterval(() => playSocialSound('call'), 1800);
    return () => window.clearInterval(interval);
  }, [incomingCall?.callId, activeCall?.callId, activeCall?.status]);

  useEffect(() => {
    if (!notice) return undefined;
    const timeout = window.setTimeout(() => setNotice(''), 5000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

  async function createGroup() {
    if (!groupName.trim() || groupMemberIds.length === 0) return;
    setBusy('group');
    try {
      await window.nocturne.createWestronGroup({
        name: groupName.trim(),
        memberUserIds: groupMemberIds,
      });
      setGroupModalOpen(false);
      setGroupName('');
      setGroupMemberIds([]);
      setGroups(await window.nocturne.listWestronGroups());
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  function openGroupConversation(group: WestronFriendGroup) {
    setSelectedGroupId(group.id);
    setSelectedFriendId('');
    setConversation([]);
    setGroupConversation([]);
    setGroupSettingsOpen(false);
    setError('');
  }

  async function sendGroupMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedGroup || !messageBody.trim()) return;
    const body = messageBody.trim();
    setBusy('group-message');
    setError('');
    try {
      const result = await window.nocturne.sendWestronGroupMessage({ groupId: selectedGroup.id, body });
      playSocialSound('message');
      setGroupConversation((items) => [...items, {
        messageId: result.messageId,
        senderUserId: selectedGroup.members.find((member) => member.username === account?.username)?.userId ?? '',
        senderUsername: account?.username ?? '',
        body,
        kind: 'text',
        createdAt: new Date().toISOString(),
      }]);
      setMessageBody('');
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function sendGroupPhoto() {
    if (!selectedGroup) return;
    setBusy('group-photo');
    setError('');
    try {
      const result = await window.nocturne.chooseAndSendWestronGroupPhoto({ groupId: selectedGroup.id });
      if (result.cancelled) return;
      playSocialSound('photo');
      setGroupConversation((items) => [...items, {
        messageId: result.messageId,
        senderUserId: selectedGroup.members.find((member) => member.username === account?.username)?.userId ?? '',
        senderUsername: account?.username ?? '',
        body: '',
        kind: 'photo',
        createdAt: new Date().toISOString(),
      }]);
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function sendMemberFriendRequest(member: WestronFriendGroup['members'][number]) {
    setBusy(`member-request:${member.userId}`);
    setError('');
    try {
      const result = await window.nocturne.sendWestronFriendRequest({ username: member.username });
      setNotice(text(result.message));
      setFriendList(await window.nocturne.listWestronFriends());
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  function openMemberConversation(userId: string) {
    setSelectedFriendId(userId);
    setSelectedGroupId('');
    setGroupMembersOpen(false);
    setGroupSettingsOpen(false);
    setGroupConversation([]);
    setConversation([]);
    setError('');
  }

  async function renameGroup() {
    if (!selectedGroup || !groupNameDraft.trim()) return;
    setBusy('group-rename');
    setError('');
    try {
      const renamed = await window.nocturne.renameWestronGroup({
        groupId: selectedGroup.id,
        name: groupNameDraft.trim(),
      });
      setGroups((items) => items.map((group) => group.id === renamed.groupId
        ? { ...group, name: renamed.name }
        : group));
      setGroupSettingsOpen(false);
      setNotice(text('Grup adı güncellendi.'));
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function confirmDeleteGroup(group: WestronFriendGroup) {
    if (groupDeleteName.trim() !== group.name) return;
    setBusy('group-delete');
    setError('');
    try {
      await window.nocturne.deleteWestronGroup({ groupId: group.id });
      setGroups((items) => items.filter((item) => item.id !== group.id));
      if (selectedGroupId === group.id) {
        setSelectedGroupId('');
        setGroupConversation([]);
      }
      setGroupSettingsOpen(false);
      setGroupDeletePrompt(null);
      setGroupDeleteName('');
      setNotice(text('Grup başarıyla silindi.'));
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function confirmRemoveGroupMember() {
    if (!groupMemberRemovalPrompt) return;
    const { group, member } = groupMemberRemovalPrompt;
    setBusy(`group-member:${member.userId}`);
    setError('');
    try {
      await window.nocturne.removeWestronGroupMember({
        groupId: group.id,
        memberUserId: member.userId,
      });
      setGroups(await window.nocturne.listWestronGroups());
      if (member.username === account?.username) {
        setSelectedGroupId('');
        setGroupConversation([]);
        setGroupSettingsOpen(false);
      }
      setGroupMemberRemovalPrompt(null);
      setNotice(text(member.username === account?.username ? 'Gruptan ayrıldınız.' : 'Üye gruptan çıkarıldı.'));
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function submitFriendRequest(event: FormEvent) {
    event.preventDefault();
    setBusy('request');
    setError('');
    try {
      const result = await window.nocturne.sendWestronFriendRequest({ username: username.trim() });
      setNotice(text(result.message));
      setUsername('');
      setFriendList(await window.nocturne.listWestronFriends());
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function respondToRequest(request: WestronFriendRequest, accept: boolean) {
    setBusy(request.requestId);
    setError('');
    try {
      await window.nocturne.respondWestronFriendRequest({ requestId: request.requestId, accept });
      setFriendList(await window.nocturne.listWestronFriends());
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function cancelOutgoingRequest(request: WestronFriendRequest) {
    setBusy(request.requestId);
    setError('');
    try {
      await window.nocturne.cancelWestronFriendRequest({ requestId: request.requestId });
      setFriendList(await window.nocturne.listWestronFriends());
      setOutgoingRequestPrompt(null);
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function removeFriend(friend: WestronFriend) {
    setRemovalPrompt(friend);
  }

  async function confirmRemoveFriend(friend: WestronFriend) {
    setBusy(friend.userId);
    setError('');
    try {
      if (activeCallRef.current?.friendUserId === friend.userId) await endVoiceCall();
      if (incomingCallRef.current?.fromUserId === friend.userId) await rejectIncomingCall();
      await window.nocturne.removeWestronFriend({ userId: friend.userId });
      setFriendList(await window.nocturne.listWestronFriends());
      if (selectedFriendId === friend.userId) setSelectedFriendId('');
      setRemovalPrompt(null);
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function sendLocalPhoto() {
    if (!selectedFriend) return;
    setPhotoMenuOpen(false);
    setBusy('photo');
    setError('');
    try {
      const result = await window.nocturne.chooseAndSendWestronPhoto({ recipientUserId: selectedFriend.userId });
      if (result.cancelled) return;
      playSocialSound('photo');
      setConversation((items) => [...items, {
        messageId: result.messageId,
        senderUserId: '',
        senderUsername: account?.username ?? '',
        recipientUserId: selectedFriend.userId,
        body: '',
        kind: 'photo',
        createdAt: new Date().toISOString(),
      }]);
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function recallMessage(messageId: string, groupId?: string) {
    setBusy(messageId);
    try {
      await window.nocturne.recallWestronMessage({ messageId, groupId });
      if (groupId) {
        setGroupConversation((items) => items.filter((item) => item.messageId !== messageId));
      } else {
        setConversation((items) => items.filter((item) => item.messageId !== messageId));
      }
      setRecallPrompt(null);
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();
    if (!selectedFriend || !messageBody.trim()) return;
    setBusy('message');
    setError('');
    try {
      const result = await window.nocturne.sendWestronEphemeralMessage({
        recipientUserId: selectedFriend.userId,
        body: messageBody.trim(),
      });
      playSocialSound('message');
      setConversation((items) => [...items, {
        messageId: result.messageId,
        senderUserId: '',
        senderUsername: account?.username ?? '',
        recipientUserId: selectedFriend.userId,
        body: messageBody.trim(),
        kind: 'text',
        createdAt: new Date().toISOString(),
      }]);
      setMessageBody('');
    } catch (reason) {
      reportApiError(reason);
    } finally {
      setBusy('');
    }
  }

  async function createPeerConnection(
    call: ActiveCall,
    groupPeer?: { userId: string; username: string },
    createMediaChannel = false,
  ) {
    if (!navigator.mediaDevices?.getUserMedia || typeof RTCPeerConnection === 'undefined') {
      throw new Error('Bu cihazda sesli arama desteklenmiyor.');
    }
    const { iceServers } = await window.nocturne.getWestronVoiceCallIceServers();
    const peer = new RTCPeerConnection({ iceServers });
    if (groupPeer) groupPeersRef.current.set(groupPeer.userId, peer);
    else peerRef.current = peer;
    const remoteUserId = groupPeer?.userId ?? call.friendUserId;
    peer.ondatachannel = (event) => attachPeerMediaChannel(event.channel, remoteUserId);
    if (createMediaChannel && remoteUserId) {
      attachPeerMediaChannel(peer.createDataChannel('westron-call-state'), remoteUserId);
    }
    peer.onicecandidate = (event) => {
      if (event.candidate) {
        sendLocalIceCandidate(call.callId, event.candidate.toJSON(), call.groupId, groupPeer?.userId);
      }
    };
    peer.ontrack = (event) => {
      if (groupPeer) {
        const stream = event.streams[0] ?? new MediaStream([event.track]);
        setGroupRemoteStreams((streams) => ({ ...streams, [groupPeer.userId]: stream }));
        return;
      }
      const audio = remoteAudioRef.current;
      if (!audio) return;
      const stream = event.streams[0] ?? new MediaStream([event.track]);
      audio.srcObject = stream;
      monitorRemoteSpeaking(stream);
      void audio.play().catch(() => undefined);
    };
    peer.onconnectionstatechange = () => {
      if (groupPeer) {
        if (peer.connectionState === 'connected') {
          const current = activeCallRef.current;
          if (current && current.groupId === call.groupId && current.callId === call.callId) {
            setCurrentCall({ ...current, status: 'active' });
          }
        } else if (peer.connectionState === 'failed') {
          setError(text('Grup sesli sohbeti bağlantısı kurulamadı.'));
          groupPeersRef.current.delete(groupPeer.userId);
          setGroupRemoteStreams((streams) => {
            const next = { ...streams };
            delete next[groupPeer.userId];
            return next;
          });
          peer.close();
        }
        return;
      }
      if (peer.connectionState === 'connected') {
        const current = activeCallRef.current;
        if (current) setCurrentCall({ ...current, status: 'active' });
      } else if (peer.connectionState === 'failed') {
        setError(text('Sesli arama bağlantısı kurulamadı. Bu ağda doğrudan bağlantı engelleniyor olabilir.'));
        closePeerConnection();
      }
    };

    return peer;
  }

  async function addLocalAudio(peer: RTCPeerConnection) {
    let stream = localStreamRef.current;
    if (!stream) {
      stream = await captureMicrophoneStream({
        deviceId: microphoneId ? { ideal: microphoneId } : undefined,
        echoCancellation: { ideal: true },
        noiseSuppression: noiseSuppressionEnabled,
        autoGainControl: { ideal: true },
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48_000 },
      });
      localStreamRef.current = stream;
      const context = new AudioContext();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      const gain = context.createGain();
      const destination = context.createMediaStreamDestination();
      gain.gain.value = microphoneVolume / 100;
      source.connect(analyser);
      analyser.connect(gain);
      gain.connect(destination);
      localAudioContextRef.current = context;
      localGainNodeRef.current = gain;
      localProcessedStreamRef.current = destination.stream;
      await context.resume();
      monitorLocalSpeaking(analyser);
    }
    for (const track of stream.getAudioTracks()) {
      track.enabled = !microphoneMutedRef.current;
      const outgoingTrack = localProcessedStreamRef.current?.getAudioTracks()[0] ?? track;
      outgoingTrack.enabled = !microphoneMutedRef.current;
      if (peer.getSenders().some((sender) => sender.track === outgoingTrack)) continue;
      const sender = peer.addTrack(outgoingTrack, localProcessedStreamRef.current ?? stream);
      const transceiver = peer.getTransceivers().find((item) => item.sender === sender);
      const capabilities = RTCRtpSender.getCapabilities?.('audio');
      if (capabilities && transceiver?.setCodecPreferences) {
        const opusCodecs = capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() === 'audio/opus');
        if (opusCodecs.length) {
          transceiver.setCodecPreferences([
            ...opusCodecs,
            ...capabilities.codecs.filter((codec) => codec.mimeType.toLowerCase() !== 'audio/opus'),
          ]);
        }
      }
      const parameters = sender.getParameters();
      if (parameters.encodings?.length) {
        parameters.encodings[0].maxBitrate = 128_000;
        void sender.setParameters(parameters).catch((reason: unknown) => setError(errorMessage(reason)));
      }
    }
  }

  function toggleMicrophone() {
    const muted = !microphoneMutedRef.current;
    microphoneMutedRef.current = muted;
    setMicrophoneMuted(muted);
    if (muted) setSelfSpeaking(false);
    if (!muted && remoteAudioMutedRef.current) {
      remoteAudioMutedRef.current = false;
      setRemoteAudioMuted(false);
      if (remoteAudioRef.current) remoteAudioRef.current.muted = false;
    }
    localStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    localProcessedStreamRef.current?.getAudioTracks().forEach((track) => { track.enabled = !muted; });
    sendLocalMediaState();
  }

  function toggleRemoteAudio() {
    const next = !remoteAudioMutedRef.current;
    remoteAudioMutedRef.current = next;
    setRemoteAudioMuted(next);
    if (remoteAudioRef.current) remoteAudioRef.current.muted = next;
    if (next && !microphoneMutedRef.current) toggleMicrophone();
    sendLocalMediaState();
  }

  async function startGroupPeerOffer(call: ActiveCall, member: WestronFriendGroup['members'][number]) {
    if (member.userId === call.groupMembers?.find((item) => item.username === account?.username)?.userId
      || groupPeersRef.current.has(member.userId)) return;
    const key = callSignalKey(call.callId, member.userId);
    localIceSignalContextRef.current.set(key, {
      recipientUserId: member.userId,
      groupId: call.groupId,
      ready: false,
    });
    const peer = await createPeerConnection(call, member, true);
    await addLocalAudio(peer);
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    await window.nocturne.sendWestronVoiceCallSignal({
      recipientUserId: member.userId,
      groupId: call.groupId,
      callId: call.callId,
      type: 'offer',
      sdp: peer.localDescription?.sdp ?? '',
    });
    await signalPendingLocalIceCandidates(call.callId, call.groupId, member.userId);
  }

  async function answerGroupPeerOffer(call: ActiveCall, signal: WestronCallSignal) {
    if (!call.groupId || groupPeersRef.current.has(signal.fromUserId)) return;
    const key = callSignalKey(call.callId, signal.fromUserId);
    localIceSignalContextRef.current.set(key, {
      recipientUserId: signal.fromUserId,
      groupId: call.groupId,
      ready: false,
    });
    const peer = await createPeerConnection(call, {
      userId: signal.fromUserId,
      username: signal.fromUsername,
    });
    await peer.setRemoteDescription({ type: 'offer', sdp: signal.sdp });
    await addPendingRemoteIceCandidates(call.callId, peer, signal.fromUserId);
    await addLocalAudio(peer);
    const answer = await peer.createAnswer();
    await peer.setLocalDescription(answer);
    await window.nocturne.sendWestronVoiceCallSignal({
      recipientUserId: signal.fromUserId,
      groupId: call.groupId,
      callId: call.callId,
      type: 'answer',
      sdp: peer.localDescription?.sdp ?? '',
    });
    await signalPendingLocalIceCandidates(call.callId, call.groupId, signal.fromUserId);
  }

  async function startGroupVoiceCall(group: WestronFriendGroup) {
    if (activeCallRef.current || incomingCallRef.current) return;
    setBusy('call');
    setError('');
    let controller: AbortController | null = null;
    try {
      const currentGroups = await window.nocturne.listWestronGroups();
      const currentGroup = currentGroups.find((item) => item.id === group.id);
      setGroups(currentGroups);
      if (!currentGroup) {
        setError(text('Grup artık bulunamadı veya bu gruba üye değilsiniz.'));
        return;
      }
      if (currentGroup.members.length > 6) {
        setError(text('P2P grup aramaları en fazla 6 kişiyle çalışır. Bu grup daha büyük; daha küçük bir grup kullanın.'));
        return;
      }
      const ownUserId = currentGroup.members.find((member) => member.username === account?.username)?.userId;
      if (!ownUserId) {
        setError(text('Grup üyeliğiniz doğrulanamadı.'));
        return;
      }
      const call: ActiveCall = {
        callId: crypto.randomUUID(),
        friendUserId: '',
        friendUsername: currentGroup.name,
        groupId: currentGroup.id,
        groupName: currentGroup.name,
        groupMembers: currentGroup.members,
        status: 'calling',
      };
      controller = new AbortController();
      callSetupControllerRef.current = controller;
      microphoneMutedRef.current = false;
      remoteAudioMutedRef.current = false;
      setMicrophoneMuted(false);
      setRemoteAudioMuted(false);
      setPeerMediaStates({});
      setCurrentCall(call);
      for (const member of currentGroup.members) {
        if (member.userId === ownUserId) continue;
        if (controller.signal.aborted) return;
        await startGroupPeerOffer(call, member);
      }
      callTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current?.callId === call.callId
          && activeCallRef.current.status !== 'active') {
          setError(text('Grup aramasına kimse katılmadı.'));
          void endVoiceCall();
        }
      }, 60_000);
    } catch (reason) {
      if (!controller?.signal.aborted) reportApiError(reason);
      if (controller) closePeerConnection();
    } finally {
      if (controller && callSetupControllerRef.current === controller) callSetupControllerRef.current = null;
      setBusy('');
    }
  }

  async function closeAddCallParticipantDialog() {
    setAddCallParticipantOpen(false);
    setCallParticipantId('');
    if (!restoreVoiceCallWindowAfterAddRef.current) return;
    restoreVoiceCallWindowAfterAddRef.current = false;
    if (!activeCallRef.current) return;
    try {
      await window.nocturne.showWestronVoiceCallWindow();
    } catch (reason) {
      reportApiError(reason);
    }
  }

  async function addFriendToActiveCall() {
    const previousCall = activeCallRef.current;
    const friend = friendList.friends.find((item) => item.userId === callParticipantId);
    if (!previousCall || previousCall.groupId || previousCall.status !== 'active' || !friend) return;
    if (friend.userId === previousCall.friendUserId) {
      setError(text('Bu kişi aramada zaten bulunuyor.'));
      return;
    }

    setBusy('add-call-participant');
    setError('');
    let groupId = '';
    let controller: AbortController | null = null;
    try {
      const currentFriend = friendList.friends.find((item) => item.userId === previousCall.friendUserId);
      if (!currentFriend) throw new Error('Mevcut arama katılımcısı arkadaş listenizde bulunamadı.');
      const created = await window.nocturne.createWestronGroup({
        name: `${TEMPORARY_CALL_GROUP_PREFIX}${Date.now().toString(36)}`,
        memberUserIds: [currentFriend.userId, friend.userId],
      });
      groupId = created.groupId;
      const currentGroups = await window.nocturne.listWestronGroups();
      const group = currentGroups.find((item) => item.id === groupId);
      if (!group || group.members.length !== 3) {
        throw new Error('Geçici arama odası oluşturulamadı veya katılımcılar doğrulanamadı.');
      }
      const ownUserId = group.members.find((member) => member.username.toLowerCase() === account?.username.toLowerCase())?.userId;
      if (!ownUserId
        || !group.members.some((member) => member.userId === currentFriend.userId)
        || !group.members.some((member) => member.userId === friend.userId)) {
        throw new Error('Geçici arama odasının üyeliği doğrulanamadı.');
      }
      if (activeCallRef.current?.callId !== previousCall.callId || incomingCallRef.current) {
        throw new Error('Arama, katılımcı eklenmeden önce sona erdi.');
      }

      const call: ActiveCall = {
        callId: crypto.randomUUID(),
        friendUserId: '',
        friendUsername: group.name,
        groupId: group.id,
        groupName: group.name,
        groupMembers: group.members,
        status: 'calling',
        temporaryGroup: true,
        temporaryGroupOwner: true,
        temporaryGroupOwnerUserId: group.ownerUserId,
      };
      controller = new AbortController();
      callSetupControllerRef.current = controller;
      resetPeersForCallUpgrade(previousCall.callId);
      setGroups(currentGroups);
      setCurrentCall(call);
      setIncoming(null);
      setAddCallParticipantOpen(false);
      setCallParticipantId('');

      for (const member of group.members) {
        if (member.userId === ownUserId) continue;
        if (controller.signal.aborted) return;
        await startGroupPeerOffer(call, member);
      }
      callTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current?.callId === call.callId
          && activeCallRef.current.status !== 'active') {
          setError(text('Grup aramasına kimse katılmadı.'));
          void endVoiceCall();
        }
      }, 60_000);
    } catch (reason) {
      if (groupId && activeCallRef.current?.groupId === groupId) {
        await endVoiceCall();
      } else if (groupId) {
        try {
          await window.nocturne.deleteWestronGroup({ groupId });
        } catch (cleanupReason) {
          reportApiError(cleanupReason);
        }
      }
      reportApiError(reason);
    } finally {
      if (controller && callSetupControllerRef.current === controller) callSetupControllerRef.current = null;
      setBusy('');
    }
  }

  async function startVoiceCall(friend: WestronFriend) {
    if (activeCallRef.current || incomingCallRef.current) return;
    const call: ActiveCall = {
      callId: crypto.randomUUID(),
      friendUserId: friend.userId,
      friendUsername: friend.username,
      status: 'calling',
    };
    const controller = new AbortController();
    callSetupControllerRef.current = controller;
    microphoneMutedRef.current = false;
    remoteAudioMutedRef.current = false;
    setMicrophoneMuted(false);
    setRemoteAudioMuted(false);
    setPeerMediaStates({});
    setCurrentCall(call);
    setBusy('call');
    setError('');
    try {
      localIceSignalContextRef.current.set(call.callId, { recipientUserId: friend.userId, ready: false });
      const peer = await createPeerConnection(call, undefined, true);
      if (controller.signal.aborted) {
        closePeerConnection();
        return;
      }
      await addLocalAudio(peer);
      if (controller.signal.aborted) {
        closePeerConnection();
        return;
      }
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      if (controller.signal.aborted) return;
      await window.nocturne.sendWestronVoiceCallSignal({
        recipientUserId: friend.userId,
        callId: call.callId,
        type: 'offer',
        sdp: peer.localDescription?.sdp ?? '',
      });
      await signalPendingLocalIceCandidates(call.callId);
      if (controller.signal.aborted || !isCurrentCall(call.callId)) {
        await window.nocturne.sendWestronVoiceCallSignal({
          recipientUserId: friend.userId,
          callId: call.callId,
          type: 'hangup',
          sdp: '',
        });
        return;
      }
      callTimeoutRef.current = window.setTimeout(() => {
        if (activeCallRef.current?.callId === call.callId) {
          setError(text('Arama yanıtlanmadı.'));
          void endVoiceCall();
        }
      }, 60_000);
    } catch (reason) {
      const cancelled = controller.signal.aborted;
      closePeerConnection();
      if (!cancelled) reportApiError(reason);
    } finally {
      if (callSetupControllerRef.current === controller) callSetupControllerRef.current = null;
      setBusy('');
    }
  }

  async function acceptIncomingCall() {
    const request = incomingCallRef.current;
    if (!request) return;
    if (callTimeoutRef.current !== null) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    if (request.groupId) {
      const group = groups.find((item) => item.id === request.groupId);
      if (!group || group.members.length > 6) {
        setError(text('Bu grup araması artık kullanılamıyor.'));
        await rejectIncomingCall();
        return;
      }
      const call: ActiveCall = {
        callId: request.callId,
        friendUserId: request.fromUserId,
        friendUsername: group.name,
        groupId: group.id,
        groupName: group.name,
        groupMembers: group.members,
        status: 'connecting',
        temporaryGroup: group.name.startsWith(TEMPORARY_CALL_GROUP_PREFIX),
        temporaryGroupOwner: false,
        temporaryGroupOwnerUserId: group.name.startsWith(TEMPORARY_CALL_GROUP_PREFIX) ? group.ownerUserId : undefined,
      };
      const controller = new AbortController();
      callSetupControllerRef.current = controller;
      microphoneMutedRef.current = false;
      remoteAudioMutedRef.current = false;
      setMicrophoneMuted(false);
      setRemoteAudioMuted(false);
      setPeerMediaStates({});
      setCurrentCall(call);
      setIncoming(null);
      retainCallNotification(request);
      setSelectedGroupId(group.id);
      setSelectedFriendId('');
      setBusy('call');
      setError('');
      try {
        await answerGroupPeerOffer(call, {
          signalId: '',
          fromUserId: request.fromUserId,
          fromUsername: request.fromUsername,
          groupId: request.groupId,
          callId: request.callId,
          type: 'offer',
          sdp: request.sdp,
        });
        const pending = pendingGroupOffersRef.current.filter((signal) =>
          signal.callId === call.callId && signal.groupId === call.groupId);
        pendingGroupOffersRef.current = pendingGroupOffersRef.current.filter((signal) =>
          signal.callId !== call.callId || signal.groupId !== call.groupId);
        for (const signal of pending) await answerGroupPeerOffer(call, signal);
        const ownUserId = group.members.find((member) => member.username === account?.username)?.userId;
        for (const member of group.members) {
          if (member.userId !== request.fromUserId && ownUserId && ownUserId < member.userId) {
            await startGroupPeerOffer(call, member);
          }
        }
      } catch (reason) {
        if (!controller.signal.aborted) reportApiError(reason);
        closePeerConnection();
      } finally {
        if (callSetupControllerRef.current === controller) callSetupControllerRef.current = null;
        setBusy('');
      }
      return;
    }
    const call: ActiveCall = {
      callId: request.callId,
      friendUserId: request.fromUserId,
      friendUsername: request.fromUsername,
      status: 'connecting',
    };
    const controller = new AbortController();
    callSetupControllerRef.current = controller;
    microphoneMutedRef.current = false;
    remoteAudioMutedRef.current = false;
    setMicrophoneMuted(false);
    setRemoteAudioMuted(false);
    setPeerMediaStates({});
    setCurrentCall(call);
    setIncoming(null);
    retainCallNotification(request);
    setBusy('call');
    setError('');
    try {
      localIceSignalContextRef.current.set(call.callId, { recipientUserId: request.fromUserId, ready: false });
      const peer = await createPeerConnection(call);
      if (controller.signal.aborted) {
        closePeerConnection();
        return;
      }
      await peer.setRemoteDescription({ type: 'offer', sdp: request.sdp });
      await addPendingRemoteIceCandidates(request.callId, peer);
      await addLocalAudio(peer);
      if (controller.signal.aborted) {
        closePeerConnection();
        return;
      }
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      if (controller.signal.aborted) return;
      await window.nocturne.sendWestronVoiceCallSignal({
        recipientUserId: request.fromUserId,
        callId: request.callId,
        type: 'answer',
        sdp: peer.localDescription?.sdp ?? '',
      });
      await signalPendingLocalIceCandidates(request.callId);
      if (controller.signal.aborted || !isCurrentCall(request.callId)) {
        await window.nocturne.sendWestronVoiceCallSignal({
          recipientUserId: request.fromUserId,
          callId: request.callId,
          type: 'hangup',
          sdp: '',
        });
      }
    } catch (reason) {
      const cancelled = controller.signal.aborted;
      closePeerConnection();
      if (!cancelled) reportApiError(reason);
    } finally {
      if (callSetupControllerRef.current === controller) callSetupControllerRef.current = null;
      setBusy('');
    }
  }

  async function rejectIncomingCall() {
    const request = incomingCallRef.current;
    if (!request) return;
    if (callTimeoutRef.current !== null) {
      window.clearTimeout(callTimeoutRef.current);
      callTimeoutRef.current = null;
    }
    onDismissNotification(getCallNotificationId(request.callId, request.groupId));
    setIncoming(null);
    pendingRemoteIceCandidatesRef.current.delete(request.callId);
    try {
      if (request.groupId) {
        const group = groups.find((item) => item.id === request.groupId);
        await Promise.all((group?.members ?? [{ userId: request.fromUserId }])
          .filter((member) => member.userId !== group?.members.find((item) => item.username === account?.username)?.userId)
          .map((member) => window.nocturne.sendWestronVoiceCallSignal({
            recipientUserId: member.userId,
            groupId: request.groupId,
            callId: request.callId,
            type: 'reject',
            sdp: '',
          })));
      } else {
        await window.nocturne.sendWestronVoiceCallSignal({
          recipientUserId: request.fromUserId,
          callId: request.callId,
          type: 'reject',
          sdp: '',
        });
      }
    } catch (reason) {
      reportApiError(reason);
    }
  }

  async function endVoiceCall() {
    const call = activeCallRef.current;
    closePeerConnection();
    if (!call) return;
    try {
      if (call.groupId) {
        const ownUserId = call.groupMembers?.find((member) => member.username === account?.username)?.userId;
        await Promise.all((call.groupMembers ?? [])
          .filter((member) => member.userId !== ownUserId)
          .map((member) => window.nocturne.sendWestronVoiceCallSignal({
            recipientUserId: member.userId,
            groupId: call.groupId,
            callId: call.callId,
            type: 'hangup',
            sdp: '',
          })));
      } else {
        await window.nocturne.sendWestronVoiceCallSignal({
          recipientUserId: call.friendUserId,
          callId: call.callId,
          type: 'hangup',
          sdp: '',
        });
      }
    } catch (reason) {
      reportApiError(reason);
    }
    if (call.groupId && call.temporaryGroupOwner) {
      try {
        await window.nocturne.deleteWestronGroup({ groupId: call.groupId });
        setGroups((current) => current.filter((group) => group.id !== call.groupId));
        if (selectedGroupId === call.groupId) {
          setSelectedGroupId('');
          setGroupConversation([]);
        }
      } catch (reason) {
        reportApiError(reason);
      }
    }
  }

  const filteredFriends = friendList.friends.filter((friend) =>
    friend.username.toLowerCase().includes(friendQuery.trim().toLowerCase()));
  const callParticipantFriends = friendList.friends.filter((friend) =>
    friend.userId !== activeCall?.friendUserId);
  return (
    <>
    <section className="friends-page" hidden={!isActive} aria-label={text('Arkadaşlar')}>
      {voiceSettingsPageOpen ? (
        <div className="friends-voice-settings-page" id="friends-voice-settings">
          <header className="friends-voice-settings-heading">
            <button className="friends-icon-action" type="button" aria-label={text('Geri')} onClick={() => setVoiceSettingsPageOpen(false)}>
              <ArrowLeft size={16} />
            </button>
            <div>
              <div className="eyebrow">{text('SES')}</div>
              <h1>{text('Ses Ayarları')}</h1>
              <p>{text('Mikrofon, hoparlör ve arama arayüzünü yapılandırın.')}</p>
            </div>
          </header>
          {error && <div className="friends-alert friends-alert-error" role="alert">{text(error)}</div>}
          <div className="friends-call-settings friends-call-settings-page" role="group" aria-label={text('Ses Ayarları')}>
            <label><span><Mic size={14} />{text('Mikrofon')}</span>
              <select value={microphoneId} onChange={(event) => {
                setMicrophoneId(event.target.value);
                localStorage.setItem('westron-microphone', event.target.value);
              }}>
                <option value="">{text('Varsayılan mikrofon')}</option>
                {microphones.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || text('Mikrofon')}</option>)}
              </select>
            </label>
            <label><span><Volume2 size={14} />{text('Hoparlör')}</span>
              <select value={speakerId} onChange={(event) => {
                setSpeakerId(event.target.value);
                localStorage.setItem('westron-speaker', event.target.value);
              }}>
                <option value="">{text('Varsayılan hoparlör')}</option>
                {speakers.map((device) => <option key={device.deviceId} value={device.deviceId}>{device.label || text('Hoparlör')}</option>)}
              </select>
            </label>
            <label className="friends-setting-toggle">
              <input type="checkbox" checked={noiseSuppressionEnabled} onChange={(event) => setNoiseSuppression(event.target.checked)} />
              <span>{text('Gürültü engelleme')}</span>
            </label>
            <label><span>{text('Mikrofon seviyesi')}</span>
              <input type="range" min="0" max="100" value={microphoneVolume} onChange={(event) => {
                const volume = Number(event.target.value);
                setMicrophoneVolume(volume);
                localStorage.setItem('westron-microphone-volume', event.target.value);
                if (localGainNodeRef.current && localAudioContextRef.current) {
                  localGainNodeRef.current.gain.setTargetAtTime(volume / 100, localAudioContextRef.current.currentTime, 0.02);
                }
                if (microphoneTestGainNodeRef.current && microphoneTestAudioContextRef.current) {
                  microphoneTestGainNodeRef.current.gain.setTargetAtTime(volume / 100, microphoneTestAudioContextRef.current.currentTime, 0.02);
                }
              }} />
            </label>
            <label><span>{text('Hoparlör seviyesi')}</span>
              <input type="range" min="0" max="100" value={speakerVolume} onChange={(event) => {
                const volume = Number(event.target.value) / 100;
                setSpeakerVolume(Number(event.target.value));
                localStorage.setItem('westron-speaker-volume', event.target.value);
                if (remoteAudioRef.current) remoteAudioRef.current.volume = volume;
                if (microphoneTestAudioRef.current) microphoneTestAudioRef.current.volume = volume;
              }} />
            </label>
            <label className="friends-setting-toggle">
              <input type="checkbox" checked={inGameOverlay} onChange={(event) => {
                setInGameOverlay(event.target.checked);
                localStorage.setItem('westron-in-game-overlay', String(event.target.checked));
              }} />
              <span>{text('Oyun içi sesli arama arayüzü')}</span>
            </label>
            <label><span>{text('Konuşan profil fotoğrafı')}</span>
              <select value={callAvatarShape} onChange={(event) => {
                const shape = event.target.value as 'round' | 'square';
                setCallAvatarShape(shape);
                localStorage.setItem('westron-call-avatar-shape', shape);
              }}>
                <option value="round">{text('Yuvarlak')}</option>
                <option value="square">{text('Kare')}</option>
              </select>
            </label>
            <div className="friends-microphone-test">
              <div><strong>{text('Mikrofon testi')}</strong><small>{text('Test sırasında arama mikrofonunuz otomatik sessize alınır.')}</small></div>
              <button className="button button-secondary button-small" type="button" disabled={busy !== '' || !navigator.mediaDevices?.getUserMedia} onClick={() => void toggleMicrophoneTest()}>
                {microphoneTestRunning ? <MicOff size={14} /> : <Mic size={14} />}
                {text(microphoneTestRunning ? 'Testi durdur' : 'Testi başlat')}
              </button>
            </div>
          </div>
          <audio ref={microphoneTestAudioRef} autoPlay />
        </div>
      ) : (
      <>
      <header className="page-heading">
        <div>
          <div className="eyebrow">{text('SOSYAL')}</div>
          <h1>{text('Arkadaşlar')}</h1>
          <p>{text('Arkadaşlarını bul, gruplarda sohbet et ve sesli konuş.')}</p>
        </div>
        <button
          type="button"
          className="button button-secondary friends-page-settings"
          aria-label={text('Ses Ayarları')}
          title={text('Ses Ayarları')}
          aria-expanded={voiceSettingsPageOpen}
          aria-controls="friends-voice-settings"
          onClick={() => {
            setVoiceSettingsPageOpen(true);
            setError('');
          }}
        ><Settings2 size={15} /><span>{text('Ses Ayarları')}</span></button>
      </header>

      {apiUnavailable ? (
        <div className="friends-alert friends-alert-warning" role="status">
          <span>{text('Arkadaşlar hizmeti henüz sunucuda etkin değil. Sunucu güncellemesi tamamlanınca yeniden deneyin.')}</span>
          <button className="text-button" onClick={() => {
            setApiUnavailable(false);
            setError('');
            setPresenceError('');
          }} type="button">{text('Yeniden dene')}</button>
        </div>
      ) : (
        <>
          {error && <div className="friends-alert friends-alert-error" role="alert">{text(error)}</div>}
          {presenceError && <div className="friends-alert friends-alert-warning" role="status">{text('Çevrimiçi durumu güncellenemedi.')}: {text(presenceError)}</div>}
        </>
      )}
      {notice && <div className="friends-alert friends-alert-success" role="status"><Check size={15} />{notice}</div>}
      {!account ? (
        <section className="friends-panel friends-login-panel">
          <Users size={28} />
          <h2>{text('Arkadaşlar için Westron hesabınıza giriş yapın.')}</h2>
          <button className="button button-primary" type="button" onClick={onOpenAccount}>
            {text('Hesaba git')}
          </button>
        </section>
      ) : !account.emailVerified ? (
        <section className="friends-panel friends-login-panel">
          <h2>{text('Arkadaşlık özellikleri için e-posta adresinizi doğrulayın.')}</h2>
          <button className="button button-secondary" type="button" onClick={onOpenAccount}>
            {text('Hesaba git')}
          </button>
        </section>
      ) : (
        <div className="friends-layout">
          <aside className="friends-sidebar">
            <section className="friends-panel">
              <h2><UserPlus size={16} />{text('Arkadaş ekle')}</h2>
              <form className="friends-add-form" onSubmit={(event) => void submitFriendRequest(event)}>
                <input
                  aria-label={text('Westron kullanıcı adı')}
                  autoComplete="off"
                  maxLength={16}
                  minLength={3}
                  pattern="[A-Za-z0-9_]{3,16}"
                  placeholder={text('Westron kullanıcı adı')}
                  required
                  value={username}
                  disabled={apiUnavailable}
                  onChange={(event) => setUsername(event.target.value)}
                  onFocus={() => setFriendSearchFocused(true)}
                  onBlur={() => setFriendSearchFocused(false)}
                />
                {friendSearchFocused && friendSuggestions.length > 0 && (
                  <div className="friends-search-suggestions">
                    {friendSuggestions.map((suggestion) => (
                      <button type="button" key={suggestion.userId} onMouseDown={(event) => event.preventDefault()} onClick={() => {
                        setUsername(suggestion.username);
                        setFriendSuggestions([]);
                        setFriendSearchFocused(false);
                      }}>
                        <FriendSkinFace username={suggestion.username} />
                        <strong>{suggestion.username}</strong>
                      </button>
                    ))}
                  </div>
                )}
                <button className="button button-primary button-small" disabled={busy !== '' || apiUnavailable} type="submit">
                  {busy === 'request' ? <LoaderCircle className="spin" size={14} /> : <UserPlus size={14} />}
                  {text('İstek gönder')}
                </button>
              </form>
            </section>

            <section className="friends-panel">
              <div className="friends-panel-heading friends-groups-heading">
                <h2><Users size={16} />{text('Gruplar')}</h2>
                <button className="button button-secondary button-small friends-group-create" type="button" onClick={() => setGroupModalOpen(true)}>
                  <UserPlus size={14} />{text('Grup oluştur')}
                </button>
              </div>
              {groups.length ? (
                <div className="friends-groups">
                  {groups.map((group) => (
                    <article className={`friends-group-card ${selectedGroupId === group.id ? 'selected' : ''}`} key={group.id}>
                      <button className="friends-group-open" type="button" onClick={() => openGroupConversation(group)}>
                        <div className="friends-group-avatars">
                          {group.members.slice(0, 4).map((member) => (
                            <span key={member.userId}><FriendSkinFace username={member.username} minecraftUsername={member.minecraftUsername} /></span>
                          ))}
                        </div>
                        <span className="friends-group-identity"><strong>{group.name}</strong><small>{group.members.length} {text('üye')}</small></span>
                      </button>
                      <button className="friends-icon-action" type="button" title={text('Grup mesajı')} aria-label={text('Grup mesajı')} onClick={() => openGroupConversation(group)}><MessageCircle size={14} /></button>
                    </article>
                  ))}
                </div>
              ) : <p className="friends-muted">{text('Henüz grup oluşturmadınız.')}</p>}
            </section>

            <section className="friends-panel">
              <h2>{text('Arkadaşlık İstekleri')} <span className="friends-count">{friendList.incomingRequests.length}</span></h2>
              {friendList.incomingRequests.length ? (
                <ul className="friends-requests">
                  {friendList.incomingRequests.map((request) => (
                    <li key={request.requestId}>
                      <span className="friends-request-identity">
                        <span className="friends-avatar friends-request-avatar"><FriendSkinFace username={request.username} /></span>
                        <strong>{request.username}</strong>
                      </span>
                      <div>
                        <button
                          className="friends-icon-action"
                          aria-label={`${text('Kabul et')}: ${request.username}`}
                          disabled={busy !== '' || apiUnavailable}
                          onClick={() => void respondToRequest(request, true)}
                          type="button"
                        ><Check size={15} /></button>
                        <button
                          className="friends-icon-action friends-action-danger"
                          aria-label={`${text('Reddet')}: ${request.username}`}
                          disabled={busy !== '' || apiUnavailable}
                          onClick={() => void respondToRequest(request, false)}
                          type="button"
                        ><X size={15} /></button>
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="friends-muted">{text('Gelen istek yok.')}</p>}
              {friendList.outgoingRequests.length > 0 && (
                <div className="friends-outgoing-requests">
                  <h3>{text('Gönderilen istekler')}</h3>
                  <ul className="friends-requests">
                    {friendList.outgoingRequests.map((request) => (
                      <li key={request.requestId}>
                        <span className="friends-request-identity">
                          <span className="friends-avatar friends-request-avatar"><FriendSkinFace username={request.username} /></span>
                          <strong>{request.username}</strong>
                        </span>
                        <button className="friends-icon-action friends-action-danger" type="button" aria-label={`${text('İsteği geri al')}: ${request.username}`} title={text('İsteği geri al')} disabled={busy !== '' || apiUnavailable} onClick={() => setOutgoingRequestPrompt(request)}><Undo2 size={14} /></button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>

            <section className="friends-panel">
              <h2>{text('Arkadaşların')} <span className="friends-count">{friendList.friends.length}</span></h2>
              {friendList.friends.length > 0 && (
                <label className="friends-search">
                  <Search size={14} />
                  <input
                    value={friendQuery}
                    onChange={(event) => setFriendQuery(event.target.value)}
                    placeholder={text('Arkadaş ara')}
                    aria-label={text('Arkadaş ara')}
                  />
                </label>
              )}
              {filteredFriends.length ? (
                <ul className="friends-list">
                  {filteredFriends.map((friend) => (
                    <li className={selectedFriendId === friend.userId ? 'selected' : ''} key={friend.userId}>
                      <button
                        className="friends-select"
                        disabled={busy !== '' || apiUnavailable}
                        onClick={() => {
                          setSelectedFriendId(friend.userId);
                          setSelectedGroupId('');
                          setGroupSettingsOpen(false);
                        }}
                        type="button"
                      >
                        <span className="friends-avatar">
                          <FriendSkinFace username={friend.username} minecraftUsername={friend.minecraftUsername} />
                          <span className={`friends-presence-dot ${friend.online ? 'online' : 'offline'}`} />
                        </span>
                        <span className="friends-identity">
                          <strong>{friend.username}</strong>
                          <small>{friend.inGame
                            ? `${text('Oyunda')}${friend.serverName ? ` · ${friend.serverName}` : ''}`
                            : text(friend.online ? 'Çevrimiçi' : 'Çevrimdışı')}</small>
                        </span>
                      </button>
                      <button
                        className="friends-icon-action friends-remove-action"
                        aria-label={`${text('Arkadaşı kaldır')}: ${friend.username}`}
                        disabled={busy !== '' || apiUnavailable}
                        onClick={() => void removeFriend(friend)}
                        title={text('Arkadaşı kaldır')}
                        type="button"
                      ><Trash2 size={14} /></button>
                    </li>
                  ))}
                </ul>
              ) : <p className="friends-muted">{friendList.friends.length
                ? text('Arama sonucu bulunamadı.')
                : text('Henüz arkadaş eklemediniz.')}</p>}
            </section>
          </aside>

          <section className="friends-panel friends-chat-panel">
            {selectedGroup ? (
              <>
                <header className="friends-chat-header friends-chat-header-group">
                  <div className="friends-group-chat-identity">
                    <div className="friends-group-chat-avatars" aria-hidden="true">
                      {selectedGroup.members.slice(0, 4).map((member) => (
                        <span className="friends-avatar" key={member.userId}>
                          <FriendSkinFace username={member.username} minecraftUsername={member.minecraftUsername} />
                        </span>
                      ))}
                    </div>
                    <div className="friends-identity">
                      <strong>{selectedGroup.name}</strong>
                      <small>{selectedGroup.members.length} {text('üye')}</small>
                    </div>
                  </div>
                  <button className="friends-icon-action" type="button" aria-label={text('Grup ayarları')} title={text('Grup ayarları')} onClick={() => {
                    setGroupNameDraft(selectedGroup.name);
                    setGroupSettingsOpen(true);
                  }}><Settings2 size={14} /></button>
                  <button className="button button-secondary button-small friends-group-members-trigger" type="button" onClick={() => setGroupMembersOpen(true)}>
                    <Users size={13} />{text('Üyeler')} · {selectedGroup.members.length}
                  </button>
                  {activeCall?.groupId === selectedGroup.id ? (
                    <button className="button button-danger button-small" type="button" onClick={() => void endVoiceCall()}>
                      <PhoneOff size={13} />{text('Aramayı bitir')}
                    </button>
                  ) : incomingCall?.groupId === selectedGroup.id ? (
                    <button className="button button-primary button-small" type="button" disabled={busy !== ''} onClick={() => void acceptIncomingCall()}>
                      <Phone size={13} />{text('Sesli aramaya katıl')}
                    </button>
                  ) : (
                    <button
                      className="button button-secondary button-small"
                      type="button"
                      disabled={busy !== '' || apiUnavailable || Boolean(activeCall) || Boolean(incomingCall)}
                      title={text('Grup sesli sohbetini başlat')}
                      onClick={() => void startGroupVoiceCall(selectedGroup)}
                    ><Phone size={13} />{text('Sesli ara')}</button>
                  )}
                </header>
                {incomingCall?.groupId === selectedGroup.id && (
                  <div className="friends-call-banner" role="status">
                    <div><Phone size={16} /><span>{text('Gelen grup araması')}: <strong>{incomingCall.fromUsername}</strong></span></div>
                    <button className="button button-secondary button-small" disabled={busy !== ''} onClick={() => void rejectIncomingCall()} type="button">
                      <PhoneOff size={13} />{text('Reddet')}
                    </button>
                  </div>
                )}
                {activeCall?.groupId === selectedGroup.id && (
                  <div className="friends-call-banner" role="status">
                    <div><Phone size={16} /><span>{text(activeCall.status === 'active' ? 'Grup sesli sohbeti sürüyor' : 'Bağlanıyor…')}: <strong>{groupRemoteStreams && Object.keys(groupRemoteStreams).length}/{Math.max(0, selectedGroup.members.length - 1)} {text('bağlı')}</strong></span></div>
                  </div>
                )}
                <div className="friends-message-area">
                  {groupConversation.length ? (
                    <div className="friends-conversation" aria-live="polite" ref={conversationRef}>
                      {groupConversation.map((message) => {
                        const outgoing = message.senderUsername === account?.username;
                        const sender = selectedGroup.members.find((member) => member.userId === message.senderUserId);
                        return (
                          <article className={`friends-message ${outgoing ? 'outgoing' : 'incoming'} ${message.kind === 'photo' ? 'friends-message-photo' : ''}`} key={message.messageId}>
                            {!outgoing && (
                              <span className="friends-avatar friends-message-avatar">
                                <FriendSkinFace username={sender?.username ?? message.senderUsername} minecraftUsername={sender?.minecraftUsername} />
                              </span>
                            )}
                            <div className={`friends-message-content ${message.kind === 'photo' ? 'friends-message-content-photo' : ''}`}>
                              <div className="friends-message-meta">
                                <strong>{outgoing ? text('Sen') : message.senderUsername}</strong>
                                <time>{new Date(message.createdAt).toLocaleTimeString(FRIEND_LOCALES[language], { hour: '2-digit', minute: '2-digit' })}</time>
                              </div>
                              {message.kind === 'photo' ? (
                                <FriendGroupPhoto
                                  groupId={selectedGroup.id}
                                  messageId={message.messageId}
                                  loadingText={text('Fotoğraf yükleniyor…')}
                                  errorText={text('Fotoğraf yüklenemedi.')}
                                  imageAlt={text('Paylaşılan fotoğraf')}
                                  onOpen={setExpandedPhoto}
                                />
                              ) : <p>{message.body}</p>}
                            </div>
                            {outgoing && (
                              <button
                                className="friends-recall-button"
                                type="button"
                                title={text('Mesajı geri al')}
                                aria-label={text('Mesajı geri al')}
                                disabled={busy === message.messageId}
                                onClick={() => setRecallPrompt({ ...message, groupId: selectedGroup.id })}
                              ><Undo2 size={12} /></button>
                            )}
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="friends-empty-chat">
                      <MessageCircle size={26} />
                      <p>{text('Bu grupta henüz mesaj yok.')}</p>
                    </div>
                  )}
                </div>
                <form className="friends-message-form friends-group-message-form" onSubmit={(event) => void sendGroupMessage(event)}>
                  <button className="friends-icon-action friends-group-photo-button" type="button" aria-label={text('Fotoğraf gönder')} title={text('Fotoğraf gönder')} disabled={busy !== '' || apiUnavailable} onClick={() => void sendGroupPhoto()}>
                    {busy === 'group-photo' ? <LoaderCircle className="spin" size={14} /> : <ImagePlus size={14} />}
                  </button>
                  <textarea
                    aria-label={text('Grup mesajı')}
                    maxLength={2000}
                    placeholder={text('Gruba mesaj yazın…')}
                    rows={2}
                    value={messageBody}
                    disabled={apiUnavailable}
                    onChange={(event) => setMessageBody(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (messageBody.trim() && busy === '' && !apiUnavailable) {
                          void sendGroupMessage(event as unknown as FormEvent);
                        }
                      }
                    }}
                  />
                  <button className="button button-primary" disabled={busy !== '' || apiUnavailable || !messageBody.trim()} type="submit">
                    {busy === 'group-message' ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
                    {text('Gönder')}
                  </button>
                  <small>{text('Grup mesajları sohbet geçmişinde saklanır.')}</small>
                </form>
              </>
            ) : selectedFriend ? (
              <>
                <header className="friends-chat-header">
                  <div className="friends-chat-peer">
                    <span className="friends-avatar friends-chat-peer-avatar">
                      <FriendSkinFace username={selectedFriend.username} minecraftUsername={selectedFriend.minecraftUsername} />
                      <span className={`friends-presence-dot ${selectedFriend.online ? 'online' : 'offline'}`} />
                    </span>
                    <div className="friends-identity">
                      <strong>{selectedFriend.username}</strong>
                      <small>{selectedFriend.inGame
                        ? `${text('Oyunda')}${selectedFriend.serverName ? ` · ${selectedFriend.serverName}` : ''}`
                        : text(selectedFriend.online ? 'Çevrimiçi' : 'Çevrimdışı')}</small>
                    </div>
                  </div>
                  <button
                    className="button button-secondary button-small"
                    disabled={busy !== '' || apiUnavailable || Boolean(activeCall) || Boolean(incomingCall)}
                    onClick={() => void startVoiceCall(selectedFriend)}
                    type="button"
                  >
                    {busy === 'call' ? <LoaderCircle className="spin" size={14} /> : <Phone size={14} />}
                    {text('Sesli ara')}
                  </button>
                </header>

                {incomingCall && (
                  <div className="friends-call-banner" role="status">
                    <div><Phone size={16} /><span>{text('Gelen sesli arama')}: <strong>{incomingCall.fromUsername}</strong></span></div>
                    <button className="button button-primary button-small" disabled={busy !== '' || apiUnavailable} onClick={() => void acceptIncomingCall()} type="button">
                      <Phone size={13} />{text('Kabul et')}
                    </button>
                    <button className="button button-secondary button-small" disabled={busy !== '' || apiUnavailable} onClick={() => void rejectIncomingCall()} type="button">
                      <PhoneOff size={13} />{text('Reddet')}
                    </button>
                  </div>
                )}
                {activeCall && (
                  <div className="friends-call-banner" role="status">
                    <div><Phone size={16} /><span>{text(activeCall.status === 'active' ? 'Sesli arama sürüyor' : 'Bağlanıyor…')}: <strong>{activeCall.friendUsername}</strong></span></div>
                    <button className="button button-secondary button-small" disabled={busy === 'call'} onClick={() => void endVoiceCall()} type="button">
                      <PhoneOff size={14} />{text('Aramayı bitir')}
                    </button>
                  </div>
                )}
                <div className="friends-message-area">
                  {conversation.length ? (
                    <div className="friends-conversation" aria-live="polite" ref={conversationRef}>
                      {conversation.map((message) => {
                        const outgoing = message.senderUserId === account?.username
                          || message.senderUsername === account?.username;
                        return (
                          <article className={`friends-message ${outgoing ? 'outgoing' : 'incoming'} ${message.kind === 'photo' ? 'friends-message-photo' : ''}`} key={message.messageId}>
                            {!outgoing && (
                              <span className="friends-avatar friends-message-avatar">
                                <FriendSkinFace username={selectedFriend.username} minecraftUsername={selectedFriend.minecraftUsername} />
                              </span>
                            )}
                            <div className={`friends-message-content ${message.kind === 'photo' ? 'friends-message-content-photo' : ''}`}>
                              <div className="friends-message-meta">
                                <strong>{outgoing ? text('Sen') : message.senderUsername}</strong>
                                <time>{new Date(message.createdAt).toLocaleTimeString(FRIEND_LOCALES[language], { hour: '2-digit', minute: '2-digit' })}</time>
                                {outgoing && (
                                  <button
                                    className="friends-recall-button"
                                    type="button"
                                    title={text('Mesajı geri al')}
                                    aria-label={text('Mesajı geri al')}
                                    disabled={busy === message.messageId}
                                    onClick={() => setRecallPrompt(message)}
                                  ><Undo2 size={12} /></button>
                                )}
                              </div>
                              {message.kind === 'photo'
                                ? <FriendPhotoMessage
                                    messageId={message.messageId}
                                    loadingText={text('Fotoğraf yükleniyor…')}
                                    errorText={text('Fotoğraf yüklenemedi.')}
                                    imageAlt={text('Paylaşılan fotoğraf')}
                                    onOpen={setExpandedPhoto}
                                  />
                                : <p>{message.body}</p>}
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="friends-empty-chat">
                      <MessageCircle size={26} />
                      <p>{text('Bu arkadaşınla konuşmaya başla.')}</p>
                    </div>
                  )}
                </div>
                <form className="friends-message-form" onSubmit={(event) => void sendMessage(event)}>
                  <div className="friends-photo-picker" ref={photoPickerRef}>
                    <button
                      className="friends-icon-action"
                      type="button"
                      aria-label={text('Tek kullanımlık fotoğraf')}
                      title={text('Tek kullanımlık fotoğraf')}
                      disabled={busy !== '' || apiUnavailable}
                      onClick={() => setPhotoMenuOpen((open) => !open)}
                    ><ImagePlus size={15} /></button>
                    {photoMenuOpen && (
                      <div className="friends-photo-menu" role="menu">
                        <button type="button" onClick={() => void sendLocalPhoto()}><ImagePlus size={14} />{text('Yerel dosya gönder')}</button>
                        <button type="button" onClick={() => { setPhotoMenuOpen(false); onOpenScreenshots(); }}><Camera size={14} />{text('Oyun içi ekran görüntüsü gönder')}</button>
                      </div>
                    )}
                  </div>
                  <textarea
                    aria-label={text('Tek kullanımlık mesaj')}
                    maxLength={2000}
                    placeholder={text('Mesajınızı yazın…')}
                    rows={2}
                    value={messageBody}
                    disabled={apiUnavailable}
                    onChange={(event) => setMessageBody(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' && !event.shiftKey) {
                        event.preventDefault();
                        if (messageBody.trim() && busy === '' && !apiUnavailable) {
                          void sendMessage(event as unknown as FormEvent);
                        }
                      }
                    }}
                  />
                  <button className="button button-primary" disabled={busy !== '' || apiUnavailable || !messageBody.trim()} type="submit">
                    {busy === 'message' ? <LoaderCircle className="spin" size={15} /> : <Send size={15} />}
                    {text('Gönder')}
                  </button>
                  <small>{text('Mesajlar normal sohbet geçmişinde saklanır.')}</small>
                </form>
              </>
            ) : (
              <div className="friends-empty-chat">
                <Users size={28} />
                <p>{text('Sohbet etmek için bir arkadaş seçin.')}</p>
              </div>
            )}
          </section>
        </div>
      )}
      </>
      )}
    </section>
    <audio ref={remoteAudioRef} autoPlay />
    {Object.entries(groupRemoteStreams).map(([userId, stream]) => (
      <GroupCallAudio
        key={userId}
        userId={userId}
        stream={stream}
        volume={speakerVolume / 100}
        muted={remoteAudioMuted}
        speakerId={speakerId}
        onSpeaking={(speakingUserId, speaking) => setGroupSpeakingUsers((users) => {
          if (users.has(speakingUserId) === speaking) return users;
          const next = new Set(users);
          if (speaking) next.add(speakingUserId);
          else next.delete(speakingUserId);
          return next;
        })}
      />
    ))}
    {activeCall && !voiceCallWindowVisible && (
      <div className="friends-call-overlay">
        <section className="friends-call-dialog" role="dialog" aria-modal="true" aria-label={text(callStatusText)}>
          <header className="friends-call-dialog-header">
            <span className="friends-call-live-dot" />
            <span>{text(callStatusText)}</span>
            <button
              className="friends-call-open"
              type="button"
              aria-label={text('Pencereyi büyüt veya geri yükle')}
              title={text('Pencereyi büyüt veya geri yükle')}
              onClick={() => {
                void window.nocturne.showWestronVoiceCallWindow().catch((reason: unknown) => setError(errorMessage(reason)));
              }}
            ><Maximize2 size={16} /></button>
            {activeCall && !activeCall.groupId && activeCall.status === 'active' && (
              <button
                className="friends-call-open"
                type="button"
                aria-label={text('Katılımcı ekle')}
                title={text('Katılımcı ekle')}
                onClick={() => {
                  setCallParticipantId('');
                  setAddCallParticipantOpen(true);
                }}
              ><UserPlus size={16} /></button>
            )}
            <button
              className="friends-call-close"
              type="button"
              aria-label={text('Aramayı bitir')}
              onClick={() => { void (activeCall ? endVoiceCall() : rejectIncomingCall()); }}
            ><X size={17} /></button>
          </header>
          <div className="friends-call-stage">
            <div className="friends-call-participants">
              <div className="friends-call-participant">
                <div className={`friends-call-avatar friends-call-avatar-self ${selfSpeaking ? 'is-speaking' : ''}`}>
                  <FriendSkinFace username={account?.username ?? 'Westron'} />
                  <CallMuteBadges microphoneMuted={microphoneMuted} speakerMuted={remoteAudioMuted} text={text} />
                </div>
                <strong>{account?.username ?? 'Westron'}</strong>
                <small>{text(microphoneMuted ? 'Mikrofon' : 'Sen')}</small>
              </div>
              {activeCall?.groupId || incomingCall?.groupId
                ? callGroupMembers
                  .filter((member) => member.username.toLowerCase() !== account?.username.toLowerCase())
                  .map((member) => (
                    <div className="friends-call-participant" key={member.userId}>
                      <div className={`friends-call-avatar ${groupSpeakingUsers.has(member.userId) ? 'is-speaking' : ''}`}>
                        <FriendSkinFace username={member.username} minecraftUsername={member.minecraftUsername} />
                        <CallMuteBadges
                          microphoneMuted={peerMediaStates[member.userId]?.microphoneMuted ?? false}
                          speakerMuted={peerMediaStates[member.userId]?.speakerMuted ?? false}
                          text={text}
                        />
                      </div>
                      <strong>{member.username}</strong>
                      <small>{text(groupRemoteStreams[member.userId]
                        ? 'Bağlandı'
                        : incomingCall?.fromUserId === member.userId ? 'Seni arıyor' : 'Bağlanıyor…')}</small>
                    </div>
                  ))
                : (
                  <div className="friends-call-participant">
                    <div className={`friends-call-avatar ${remoteSpeaking ? 'is-speaking' : ''}`}>
                      <FriendSkinFace
                        username={callUsername}
                        minecraftUsername={callFriend?.minecraftUsername}
                      />
                      <CallMuteBadges
                        microphoneMuted={peerMediaStates[activeCall?.friendUserId ?? incomingCall?.fromUserId ?? '']?.microphoneMuted ?? false}
                        speakerMuted={peerMediaStates[activeCall?.friendUserId ?? incomingCall?.fromUserId ?? '']?.speakerMuted ?? false}
                        text={text}
                      />
                    </div>
                    <strong>{callUsername}</strong>
                    <small>{text(callStatusText)}</small>
                  </div>
                )}
            </div>
          </div>
          <footer className="friends-call-controls">
            {incomingCall ? (
              <>
                <button
                  className="friends-call-control friends-call-end"
                  type="button"
                  aria-label={text('Reddet')}
                  title={text('Reddet')}
                  onClick={() => void rejectIncomingCall()}
                ><PhoneOff size={20} /></button>
                <button
                  className="friends-call-control friends-call-answer"
                  type="button"
                  aria-label={text('Kabul et')}
                  title={text('Kabul et')}
                  disabled={busy !== ''}
                  onClick={() => void acceptIncomingCall()}
                ><Phone size={20} /></button>
              </>
            ) : (
              <>
                <button
                  className={`friends-call-control ${microphoneMuted ? 'is-muted' : ''}`}
                  type="button"
                  aria-label={text('Mikrofon')}
                  aria-pressed={microphoneMuted}
                  title={text('Mikrofon')}
                  onClick={toggleMicrophone}
                >{microphoneMuted ? <MicOff size={19} /> : <Mic size={19} />}</button>
                <button
                  className={`friends-call-control ${remoteAudioMuted ? 'is-muted' : ''}`}
                  type="button"
                  aria-label={text('Hoparlör')}
                  aria-pressed={remoteAudioMuted}
                  title={text('Hoparlör')}
                  onClick={toggleRemoteAudio}
                >{remoteAudioMuted ? <VolumeX size={19} /> : <Volume2 size={19} />}</button>
                <button
                  className="friends-call-control friends-call-end"
                  type="button"
                  aria-label={text('Aramayı bitir')}
                  title={text('Aramayı bitir')}
                  onClick={() => void endVoiceCall()}
                ><PhoneOff size={20} /></button>
              </>
            )}
          </footer>
        </section>
      </div>
    )}
    {addCallParticipantOpen && activeCall && !activeCall.groupId && (
      <div
        className="friends-confirm-backdrop friends-add-call-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) void closeAddCallParticipantDialog();
        }}
      >
        <section className="friends-confirm-modal friends-add-call-modal" role="dialog" aria-modal="true" aria-labelledby="add-call-participant-title">
          <div className="friends-modal-heading">
            <div><span className="eyebrow">{text('Sesli arama')}</span><h2 id="add-call-participant-title">{text('Katılımcı ekle')}</h2></div>
            <button className="friends-icon-action" type="button" aria-label={text('Kapat')} onClick={() => void closeAddCallParticipantDialog()}><X size={15} /></button>
          </div>
          <p>{text('Bir arkadaş seçerek geçici grup aramasına geçin. Oda arama bitince silinir.')}</p>
          {error && <div className="friends-alert friends-alert-error" role="alert">{text(error)}</div>}
          <label className="friends-add-call-select">
            <span>{text('Arkadaş seçin')}</span>
            <select value={callParticipantId} onChange={(event) => setCallParticipantId(event.target.value)}>
              <option value="">{text('Arkadaş seçin')}</option>
              {callParticipantFriends.map((friend) => (
                <option key={friend.userId} value={friend.userId}>{friend.username}</option>
              ))}
            </select>
          </label>
          <div className="friends-confirm-actions">
            <button className="button button-secondary" type="button" onClick={() => void closeAddCallParticipantDialog()}>{text('İptal')}</button>
            <button className="button button-primary" type="button" disabled={!callParticipantId || busy !== ''} onClick={() => void addFriendToActiveCall()}>
              {busy === 'add-call-participant' ? <LoaderCircle className="spin" size={14} /> : <UserPlus size={14} />}{text('Ekle')}
            </button>
          </div>
        </section>
      </div>
    )}
    {groupMembersOpen && selectedGroup && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setGroupMembersOpen(false);
      }}>
        <section className="friends-confirm-modal friends-group-member-modal" role="dialog" aria-modal="true" aria-labelledby="group-members-title">
          <div className="friends-modal-heading">
            <div><span className="eyebrow">{text('GRUP')}</span><h2 id="group-members-title">{selectedGroup.name} · {text('Üyeler')}</h2></div>
            <button className="friends-icon-action" type="button" aria-label={text('Kapat')} onClick={() => setGroupMembersOpen(false)}><X size={15} /></button>
          </div>
          <div className="friends-group-member-list">
            {selectedGroup.members.map((member) => {
              const friend = friendList.friends.find((item) => item.userId === member.userId);
              const incoming = friendList.incomingRequests.find((item) => item.userId === member.userId);
              const outgoing = friendList.outgoingRequests.some((item) => item.userId === member.userId);
              const isSelf = member.username === account?.username;
              return (
                <div className="friends-group-member-row" key={member.userId}>
                  <span className="friends-avatar"><FriendSkinFace username={member.username} minecraftUsername={member.minecraftUsername} /></span>
                  <strong>{member.username}{isSelf ? ` · ${text('Sen')}` : ''}</strong>
                  <div className="friends-group-member-actions">
                    {friend && !isSelf && (
                      <button className="button button-secondary" type="button" onClick={() => openMemberConversation(friend.userId)}>
                        <MessageCircle size={12} />{text('Mesaj')}
                      </button>
                    )}
                    {incoming && !isSelf && (
                      <>
                        <button className="button button-primary" type="button" disabled={busy !== ''} onClick={() => void respondToRequest(incoming, true)}><Check size={12} />{text('Kabul et')}</button>
                        <button className="button button-secondary" type="button" disabled={busy !== ''} onClick={() => void respondToRequest(incoming, false)}><X size={12} />{text('Reddet')}</button>
                      </>
                    )}
                    {!friend && !incoming && !outgoing && !isSelf && (
                      <button className="button button-secondary" type="button" disabled={busy !== '' || apiUnavailable} onClick={() => void sendMemberFriendRequest(member)}>
                        {busy === `member-request:${member.userId}` ? <LoaderCircle className="spin" size={12} /> : <UserPlus size={12} />}{text('Arkadaş ekle')}
                      </button>
                    )}
                    {outgoing && !isSelf && <small>{text('İstek gönderildi')}</small>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    )}
    {groupModalOpen && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setGroupModalOpen(false);
      }}>
        <section className="friends-confirm-modal friends-group-modal" role="dialog" aria-modal="true" aria-labelledby="create-group-title">
          <header className="friends-group-modal-heading">
            <span className="friends-group-modal-icon"><Users size={18} /></span>
            <div>
              <h2 id="create-group-title">{text('Grup oluştur')}</h2>
              <p>{text('Grup için arkadaş seçin.')}</p>
            </div>
            <button className="friends-icon-action" type="button" aria-label={text('Kapat')} onClick={() => setGroupModalOpen(false)}><X size={15} /></button>
          </header>
          <label className="friends-group-name-label">
            <span>{text('Grup adı')}</span>
            <input className="friends-group-name" value={groupName} maxLength={32} placeholder={text('Grup adı')} onChange={(event) => setGroupName(event.target.value)} />
          </label>
          <div className="friends-group-members-heading">
            <strong>{text('Arkadaşların')}</strong>
            <span>{groupMemberIds.length}/{friendList.friends.length}</span>
          </div>
          <div className="friends-group-members">
            {friendList.friends.map((friend) => (
              <label key={friend.userId} className={groupMemberIds.includes(friend.userId) ? 'selected' : ''}>
                <input type="checkbox" checked={groupMemberIds.includes(friend.userId)} onChange={(event) => setGroupMemberIds((ids) => event.target.checked ? [...ids, friend.userId] : ids.filter((id) => id !== friend.userId))} />
                <span><FriendSkinFace username={friend.username} minecraftUsername={friend.minecraftUsername} /></span>
                <strong>{friend.username}</strong>
                {groupMemberIds.includes(friend.userId) && <Check size={14} />}
              </label>
            ))}
            {!friendList.friends.length && <p className="friends-muted">{text('Henüz arkadaş eklemediniz.')}</p>}
          </div>
          <div className="friends-confirm-actions">
            <button className="button button-secondary" type="button" onClick={() => setGroupModalOpen(false)}>{text('İptal')}</button>
            <button className="button button-primary" type="button" disabled={busy !== '' || apiUnavailable || !groupName.trim() || groupMemberIds.length === 0} onClick={() => void createGroup()}>
              {busy === 'group' && <LoaderCircle className="spin" size={14} />}
              {text('Oluştur')}
            </button>
          </div>
        </section>
      </div>
    )}
    {groupSettingsOpen && selectedGroup && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setGroupSettingsOpen(false);
      }}>
        <section className="friends-confirm-modal friends-group-modal" role="dialog" aria-modal="true" aria-labelledby="group-settings-title">
          <header className="friends-group-modal-heading">
            <span className="friends-group-modal-icon"><Settings2 size={18} /></span>
            <div>
              <h2 id="group-settings-title">{text('Grup ayarları')}</h2>
              <p>{text('Üyeleri yönetin ve grup adını düzenleyin.')}</p>
            </div>
            <button className="friends-icon-action" type="button" aria-label={text('Kapat')} onClick={() => setGroupSettingsOpen(false)}><X size={15} /></button>
          </header>
          {selectedGroup.members.some((member) => member.userId === selectedGroup.createdByUserId && member.username === account?.username) && (
            <form className="friends-group-rename-form" onSubmit={(event) => {
              event.preventDefault();
              void renameGroup();
            }}>
              <label className="friends-group-name-label">
                <span>{text('Grup adı')}</span>
                <input className="friends-group-name" value={groupNameDraft} maxLength={32} onChange={(event) => setGroupNameDraft(event.target.value)} />
              </label>
              <button className="button button-primary button-small" type="submit" disabled={busy !== '' || !groupNameDraft.trim() || groupNameDraft.trim() === selectedGroup.name}>
                {busy === 'group-rename' && <LoaderCircle className="spin" size={14} />}
                {text('Kaydet')}
              </button>
            </form>
          )}
          {selectedGroup.ownerUserId === selectedGroup.members.find((member) => member.username === account?.username)?.userId && (
            <button
              className="button button-danger friends-group-delete"
              type="button"
              disabled={busy !== ''}
              onClick={() => {
                setGroupDeleteName('');
                setGroupDeletePhase('confirm');
                setGroupDeletePrompt(selectedGroup);
              }}
            ><Trash2 size={14} />{text('Grubu sil')}</button>
          )}
          <div className="friends-group-members-heading">
            <strong>{text('Grup üyeleri')}</strong>
            <span>{selectedGroup.members.length}</span>
          </div>
          <div className="friends-group-settings-members">
            {selectedGroup.members.map((member) => {
              const isOwner = member.userId === selectedGroup.ownerUserId;
              const isSelf = member.username === account?.username;
              const canRemove = isSelf || selectedGroup.ownerUserId === selectedGroup.members.find((item) => item.username === account?.username)?.userId;
              return (
                <div className="friends-group-settings-member" key={member.userId}>
                  <span className="friends-avatar"><FriendSkinFace username={member.username} minecraftUsername={member.minecraftUsername} /></span>
                  <strong>{member.username}</strong>
                  {isOwner && <small>{text('Kurucu')}</small>}
                  {canRemove && (
                    <button className={`friends-icon-action ${isSelf ? 'friends-action-danger' : ''}`} type="button" disabled={busy !== ''} aria-label={`${text(isSelf ? 'Gruptan ayrıl' : 'Üyeyi çıkar')}: ${member.username}`} onClick={() => setGroupMemberRemovalPrompt({ group: selectedGroup, member })}>
                      {isSelf ? <Undo2 size={14} /> : <Trash2 size={14} />}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      </div>
    )}
    {groupDeletePrompt && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget && busy === '') {
          setGroupDeletePrompt(null);
          setGroupDeleteName('');
          setGroupDeletePhase('confirm');
        }
      }}>
        <section className="friends-confirm-modal friends-group-delete-modal" role="dialog" aria-modal="true" aria-labelledby="delete-group-title">
          <div className="friends-confirm-icon"><Trash2 size={20} /></div>
          <h2 id="delete-group-title">{text('Grubu sil')}</h2>
          {groupDeletePhase === 'confirm' ? (
            <>
              <p>{text('Bu grubu silmek istediğinizden emin misiniz?')}</p>
              <strong>{groupDeletePrompt.name}</strong>
              <div className="friends-confirm-actions">
                <button className="button button-secondary" type="button" onClick={() => {
                  setGroupDeletePrompt(null);
                  setGroupDeletePhase('confirm');
                }}>{text('İptal')}</button>
                <button className="button button-danger" type="button" onClick={() => setGroupDeletePhase('verify')}>
                  <Trash2 size={14} />{text('Devam et')}
                </button>
              </div>
            </>
          ) : (
            <>
              <p>{text('Grup silme işlemi geri alınamaz. Onaylamak için grup adını yazın.')}</p>
              <strong>{groupDeletePrompt.name}</strong>
              <label className="friends-group-name-label">
                <span>{text('Grup adını yazın')}</span>
                <input
                  className="friends-group-name"
                  autoComplete="off"
                  autoFocus
                  value={groupDeleteName}
                  onChange={(event) => setGroupDeleteName(event.target.value)}
                />
              </label>
              <div className="friends-confirm-actions">
                <button className="button button-secondary" type="button" disabled={busy !== ''} onClick={() => setGroupDeletePhase('confirm')}>{text('Geri')}</button>
                <button
                  className="button button-danger"
                  type="button"
                  disabled={busy !== '' || groupDeleteName.trim() !== groupDeletePrompt.name}
                  onClick={() => void confirmDeleteGroup(groupDeletePrompt)}
                >
                  {busy === 'group-delete' ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
                  {text('Grubu sil')}
                </button>
              </div>
            </>
          )}
        </section>
      </div>
    )}
    {groupMemberRemovalPrompt && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setGroupMemberRemovalPrompt(null);
      }}>
        <section className="friends-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-group-member-title">
          <div className="friends-confirm-icon"><Trash2 size={20} /></div>
          <h2 id="remove-group-member-title">{text(groupMemberRemovalPrompt.member.username === account?.username ? 'Gruptan ayrıl' : 'Üyeyi çıkar')}</h2>
          <p>{text(groupMemberRemovalPrompt.member.username === account?.username ? 'Bu gruptan ayrılmak istiyor musunuz?' : 'Bu üyeyi gruptan çıkarmak istiyor musunuz?')}</p>
          <strong>{groupMemberRemovalPrompt.member.username}</strong>
          <div className="friends-confirm-actions">
            <button className="button button-secondary" type="button" onClick={() => setGroupMemberRemovalPrompt(null)}>{text('İptal')}</button>
            <button className="button button-danger" type="button" disabled={busy !== ''} onClick={() => void confirmRemoveGroupMember()}>
              {busy === `group-member:${groupMemberRemovalPrompt.member.userId}` ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
              {text(groupMemberRemovalPrompt.member.username === account?.username ? 'Ayrıl' : 'Çıkar')}
            </button>
          </div>
        </section>
      </div>
    )}
    {outgoingRequestPrompt && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setOutgoingRequestPrompt(null);
      }}>
        <section className="friends-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-request-title">
          <div className="friends-confirm-icon"><Undo2 size={20} /></div>
          <h2 id="cancel-request-title">{text('İsteği geri al')}</h2>
          <p>{text('Gönderilen arkadaşlık isteğini geri almak istiyor musunuz?')}</p>
          <strong>{outgoingRequestPrompt.username}</strong>
          <div className="friends-confirm-actions">
            <button className="button button-secondary" type="button" onClick={() => setOutgoingRequestPrompt(null)}>{text('İptal')}</button>
            <button className="button button-danger" type="button" disabled={busy !== ''} onClick={() => void cancelOutgoingRequest(outgoingRequestPrompt)}>
              {busy === outgoingRequestPrompt.requestId ? <LoaderCircle className="spin" size={14} /> : <Undo2 size={14} />}
              {text('Geri al')}
            </button>
          </div>
        </section>
      </div>
    )}
    {recallPrompt && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setRecallPrompt(null);
      }}>
        <section className="friends-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="recall-message-title">
          <div className="friends-confirm-icon"><Trash2 size={20} /></div>
          <h2 id="recall-message-title">{text('Mesajı geri al')}</h2>
          <p>{text('Gönderilen mesajı veya fotoğrafı geri almak istiyor musunuz?')}</p>
          <strong>{recallPrompt.kind === 'photo' ? text('Paylaşılan fotoğraf') : recallPrompt.body}</strong>
          <div className="friends-confirm-actions">
            <button className="button button-secondary" type="button" onClick={() => setRecallPrompt(null)}>{text('İptal')}</button>
            <button className="button button-danger" type="button" disabled={busy !== ''} onClick={() => void recallMessage(recallPrompt.messageId, recallPrompt.groupId)}>
              {busy === recallPrompt.messageId ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
              {text('Geri al')}
            </button>
          </div>
        </section>
      </div>
    )}
    {removalPrompt && (
      <div className="friends-confirm-backdrop" role="presentation" onMouseDown={(event) => {
        if (event.target === event.currentTarget) setRemovalPrompt(null);
      }}>
        <section className="friends-confirm-modal" role="dialog" aria-modal="true" aria-labelledby="remove-friend-title">
          <div className="friends-confirm-icon"><Trash2 size={20} /></div>
          <h2 id="remove-friend-title">{text('Arkadaşı kaldır')}</h2>
          <p>{text('Bu kullanıcıyı arkadaşlığınızdan kaldırmak istiyor musunuz?')}</p>
          <strong>{removalPrompt.username}</strong>
          <div className="friends-confirm-actions">
            <button className="button button-secondary" type="button" onClick={() => setRemovalPrompt(null)}>{text('İptal')}</button>
            <button className="button button-danger" type="button" disabled={busy !== ''} onClick={() => void confirmRemoveFriend(removalPrompt)}>
              {busy === removalPrompt.userId ? <LoaderCircle className="spin" size={14} /> : <Trash2 size={14} />}
              {text('Kaldır')}
            </button>
          </div>
        </section>
      </div>
    )}
    {expandedPhoto && (
      <div
        className="friends-photo-lightbox-backdrop"
        role="presentation"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) setExpandedPhoto('');
        }}
      >
        <section className="friends-photo-lightbox" role="dialog" aria-modal="true" aria-label={text('Paylaşılan fotoğraf')}>
          <button className="friends-icon-action" type="button" aria-label={text('Kapat')} onClick={() => setExpandedPhoto('')}>
            <X size={16} />
          </button>
          <img src={expandedPhoto} alt={text('Paylaşılan fotoğraf')} />
        </section>
      </div>
    )}
    </>
  );
}
