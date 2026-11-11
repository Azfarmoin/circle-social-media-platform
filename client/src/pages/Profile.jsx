import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { useForm, useFieldArray } from 'react-hook-form';
import { Camera, MapPin, Globe, GraduationCap, Briefcase, Heart, Cake, Languages, Pencil, Lock, UserRound, Ban, Flag, VolumeX, Plus, Trash2, Bell, BellOff, ImageOff, MessageCircle, CalendarDays, Users, AtSign, UserPlus, UserCheck } from 'lucide-react';
import { RELATIONSHIP_STATUSES, LIMITS } from '@shared/constants.js';
import { profileApi, friendApi, postApi, messageApi } from '../api/index.js';
import { errorMessage, fieldErrors } from '../api/http.js';
import { Avatar, Verified, Tabs, Modal, Field, Spinner, Skeleton, Empty, Menu, ConfirmDialog, ErrorState } from '../components/ui/index.jsx';
import FriendActions from '../components/people/FriendActions.jsx';
import PersonRow from '../components/people/PersonRow.jsx';
import Composer from '../components/post/Composer.jsx';
import { ReportModal } from '../components/post/Modals.jsx';
import Sentinel from '../components/ui/Sentinel.jsx';
import { PostList } from './Feed.jsx';
import { usePostFeed, useInfinite, useCurrentUser, useTitle, useToast } from '../lib/hooks.js';
import { userUpdated } from '../store/slices.js';
import { compact } from '../lib/format.js';

const REL = (s) => s.replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

function ImageUpload({ kind, current, onDone, children }) {
  const ref = useRef(null);
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const pick = async (e) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (f.size > LIMITS.uploadBytes) return toast('That image is larger than 4 MB.', 'error');
    setBusy(true);
    try { onDone((await profileApi.setImage(kind, f)).url); toast(kind === 'avatar' ? 'Profile photo updated' : 'Cover photo updated', 'success'); } catch (err) { toast(errorMessage(err), 'error'); } finally { setBusy(false); }
  };
  const remove = async () => { try { await profileApi.removeImage(kind); onDone(''); } catch (err) { toast(errorMessage(err), 'error'); } };
  return (
    <>
      <input ref={ref} hidden type="file" accept="image/jpeg,image/png,image/webp,image/gif" onChange={pick} />
      {children({ open: () => ref.current?.click(), busy, remove: current ? remove : null })}
    </>
  );
}

function EditProfileModal({ open, onClose, user, about, onSaved }) {
  const toast = useToast();
  const { register, control, handleSubmit, setError, formState: { errors, isSubmitting } } = useForm({
    defaultValues: {
      name: user.name, bio: user.bio || '', website: about?.website || '', location: about?.location || '', relationshipStatus: about?.relationshipStatus || '',
      birthday: about?.birthday ? String(about.birthday).slice(0, 10) : '', languages: (about?.languages || []).join(', '),
      education: about?.education?.length ? about.education : [], work: about?.work?.length ? about.work : [],
    },
  });
  const edu = useFieldArray({ control, name: 'education' });
  const work = useFieldArray({ control, name: 'work' });
  const num = (v) => (v === '' || v == null ? undefined : Number(v));
  const onSubmit = async (v) => {
    try {
      const body = {
        name: v.name.trim(), bio: v.bio.trim(), website: v.website.trim(), location: v.location.trim(), relationshipStatus: v.relationshipStatus,
        birthday: v.birthday ? new Date(v.birthday).toISOString() : null,
        languages: v.languages.split(',').map((x) => x.trim()).filter(Boolean),
        education: v.education.filter((e) => e.school?.trim()).map((e) => ({ school: e.school.trim(), degree: e.degree?.trim() || undefined, from: num(e.from), to: num(e.to) })),
        work: v.work.filter((e) => e.company?.trim()).map((e) => ({ company: e.company.trim(), position: e.position?.trim() || undefined, from: num(e.from), to: num(e.to) })),
      };
      await profileApi.update(body);
      toast('Profile saved', 'success');
      onSaved();
      onClose();
    } catch (e) {
      const f = fieldErrors(e);
      Object.entries(f).forEach(([k, m]) => setError(k.split('.')[0], { message: m }));
      toast(errorMessage(e), 'error');
    }
  };
  return (
    <Modal open={open} onClose={onClose} wide title="Edit profile" footer={<>
      <button className="btn-ghost" onClick={onClose}>Cancel</button>
      <button form="edit-profile" className="btn-primary" disabled={isSubmitting}>{isSubmitting && <Spinner className="h-4 w-4" />}Save changes</button></>}>
      <form id="edit-profile" onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
        <Field label="Name" error={errors.name?.message}><input className="input" maxLength={LIMITS.name} {...register('name', { required: 'Name is required' })} /></Field>
        <Field label="Bio" hint={`Up to ${LIMITS.bio} characters`} error={errors.bio?.message}><textarea className="input" rows={3} maxLength={LIMITS.bio} {...register('bio')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Location" error={errors.location?.message}><input className="input" {...register('location')} /></Field>
          <Field label="Website" error={errors.website?.message}><input className="input" placeholder="https://" {...register('website', { pattern: { value: /^$|^https?:\/\//i, message: 'Must start with http:// or https://' } })} /></Field>
          <Field label="Relationship"><select className="input" {...register('relationshipStatus')}><option value="">Prefer not to say</option>{RELATIONSHIP_STATUSES.map((r) => <option key={r} value={r}>{REL(r)}</option>)}</select></Field>
          <Field label="Birthday" error={errors.birthday?.message}><input className="input" type="date" max={new Date().toISOString().slice(0, 10)} {...register('birthday')} /></Field>
        </div>
        <Field label="Languages" hint="Separate with commas"><input className="input" {...register('languages')} /></Field>
        {[['education', edu, 'school', 'Education', 'School', 'degree', 'Degree'], ['work', work, 'company', 'Work', 'Company', 'position', 'Position']].map(([name, arr, k1, title, p1, k2, p2]) => (
          <fieldset key={name} className="space-y-2"><legend className="label">{title}</legend>
            {arr.fields.map((f, i) => (
              <div key={f.id} className="grid grid-cols-[1fr_1fr_4.5rem_4.5rem_auto] items-center gap-2">
                <input className="input" aria-label={p1} placeholder={p1} {...register(`${name}.${i}.${k1}`)} />
                <input className="input" aria-label={p2} placeholder={p2} {...register(`${name}.${i}.${k2}`)} />
                <input className="input" aria-label="From year" placeholder="From" inputMode="numeric" {...register(`${name}.${i}.from`)} />
                <input className="input" aria-label="To year" placeholder="To" inputMode="numeric" {...register(`${name}.${i}.to`)} />
                <button type="button" className="btn-ghost !p-2" aria-label={`Remove ${title} entry`} onClick={() => arr.remove(i)}><Trash2 className="h-4 w-4" /></button>
              </div>))}
            {arr.fields.length < 10 && <button type="button" className="btn-soft !py-1.5" onClick={() => arr.append({})}><Plus className="h-4 w-4" />Add {title.toLowerCase()}</button>}
          </fieldset>))}
      </form>
    </Modal>
  );
}

function AboutSection({ title, icon: Icon, children, empty }) {
  return (
    <section className="card p-5" aria-label={title}>
      <h3 className="mb-3 flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-mute"><Icon className="h-4 w-4" />{title}</h3>
      {children || <p className="text-sm text-mute">{empty}</p>}
    </section>
  );
}
const Row = ({ icon: Icon, label, children }) => (
  <div className="flex items-start gap-3 py-1.5 text-[15px]">
    <Icon className="mt-0.5 h-5 w-5 shrink-0 text-mute" aria-hidden="true" />
    <div className="min-w-0"><div className="text-xs text-mute">{label}</div><div className="break-words">{children}</div></div>
  </div>
);
const years = (e) => (e.from ? ` · ${e.from}–${e.to || 'present'}` : '');

/** The About page: grouped sections for overview, work, education, basics and connections. */
function About({ user, about, counts, isMe, onEdit }) {
  const first = user.name.split(' ')[0];
  if (!about) return <Empty icon={Lock} title="About is private" hint={`${first} only shares these details with friends.`} />;
  const joined = user.createdAt && new Date(user.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  const none = isMe ? 'Nothing added yet.' : 'Nothing to show.';
  const basics = about.birthday || about.relationshipStatus || about.languages?.length;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <AboutSection title="Overview" icon={AtSign}>
        {user.bio && <p className="mb-2 whitespace-pre-wrap text-[15px]">{user.bio}</p>}
        <Row icon={AtSign} label="Username">@{user.username}</Row>
        {about.location && <Row icon={MapPin} label="Lives in">{about.location}</Row>}
        {about.website && <Row icon={Globe} label="Website"><a href={about.website} target="_blank" rel="noopener noreferrer nofollow" className="text-brand-600 hover:underline">{about.website}</a></Row>}
        {joined && <Row icon={CalendarDays} label="Joined">{joined}</Row>}
      </AboutSection>
      <AboutSection title="Connections" icon={Users}>
        <Row icon={Users} label="Friends">{counts.friends ?? 0}</Row>
        <Row icon={UserPlus} label="Followers">{counts.followers ?? 0}</Row>
        <Row icon={UserCheck} label="Following">{counts.following ?? 0}</Row>
      </AboutSection>
      <AboutSection title="Work" icon={Briefcase} empty={none}>
        {about.work?.length ? about.work.map((w, i) => <Row key={i} icon={Briefcase} label={`${w.from ? `${w.from}–${w.to || 'present'}` : 'Work'}`}>{w.position ? `${w.position} at ` : 'Works at '}<strong>{w.company}</strong></Row>) : null}
      </AboutSection>
      <AboutSection title="Education" icon={GraduationCap} empty={none}>
        {about.education?.length ? about.education.map((e, i) => <Row key={i} icon={GraduationCap} label={`${e.from ? `${e.from}–${e.to || 'present'}` : 'Education'}`}>{e.degree ? `${e.degree}, ` : 'Studied at '}<strong>{e.school}</strong></Row>) : null}
      </AboutSection>
      <AboutSection title="Basic info" icon={Cake} empty={none}>
        {basics ? <>
          {about.birthday && <Row icon={Cake} label="Birthday">{new Date(about.birthday).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })}</Row>}
          {about.relationshipStatus && <Row icon={Heart} label="Relationship">{REL(about.relationshipStatus)}</Row>}
          {about.languages?.length > 0 && <Row icon={Languages} label="Languages">{about.languages.join(', ')}</Row>}
        </> : null}
      </AboutSection>
      {isMe && <div className="md:col-span-2"><button className="btn-soft" onClick={onEdit}><Pencil className="h-4 w-4" />Edit details</button></div>}
    </div>
  );
}

function PhotoGrid({ userId, kind }) {
  const list = useInfinite((cursor) => postApi.byUser(userId, { kind, cursor, limit: 20 }), [userId, kind]);
  const photos = list.items.flatMap((p) => (p.media || []).map((m) => ({ ...m, post: p._id })));
  return (
    <div className="space-y-4">
      {list.error && <ErrorState message={list.error} onRetry={list.reload} />}
      <div className="grid grid-cols-3 gap-1 overflow-hidden rounded-2xl sm:grid-cols-4">
        {photos.map((m) => <Link key={m.url} to={`/post/${m.post}`} className="aspect-square bg-line"><img src={m.url} alt="" loading="lazy" className="h-full w-full object-cover transition hover:opacity-90" /></Link>)}
      </div>
      {list.empty && <Empty icon={ImageOff} title="No photos yet" />}
      <Sentinel loading={list.loading} done={list.done} error={list.error} onMore={list.loadMore} />
    </div>
  );
}

function FriendsTab({ userId, visible }) {
  const list = useInfinite((cursor) => (visible ? friendApi.ofUser(userId, { cursor, limit: 24 }) : Promise.resolve({ items: [] })), [userId, visible]);
  if (!visible) return <Empty icon={Lock} title="Friend list is private" />;
  return (
    <div className="card divide-y divide-line px-4">
      {list.items.map((u) => <PersonRow key={u._id} user={u} />)}
      {list.empty && <p className="py-10 text-center text-sm text-mute">No friends to show.</p>}
      {list.loading && <div className="flex justify-center py-6"><Spinner /></div>}
      <Sentinel loading={false} done={list.done} error={list.error} onMore={list.loadMore} />
    </div>
  );
}

function ProfilePosts({ data, isMe, kind }) {
  const feed = usePostFeed((cursor) => postApi.byUser(data.user._id, { kind, cursor, limit: 10 }), [data.user._id, kind]);
  return (
    <div className="space-y-4">
      {isMe && kind === 'all' && <Composer onPosted={feed.prepend} />}
      <PostList feed={feed} empty={<Empty icon={UserRound} title={kind === 'tagged' ? 'No tagged posts' : 'No posts yet'} hint={isMe ? 'Share your first post above.' : undefined} />} />
    </div>
  );
}

export default function Profile() {
  const { username, tab: tabParam } = useParams();
  const me = useCurrentUser();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const toast = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [edit, setEdit] = useState(false);
  const [report, setReport] = useState(false);
  const [confirmBlock, setConfirmBlock] = useState(false);
  const [following, setFollowing] = useState(false);
  const [version, setVersion] = useState(0);
  useTitle(data?.user?.name);

  useEffect(() => {
    let live = true;
    setData(null); setError(null);
    profileApi.get(username).then((d) => { if (live) { setData(d); setFollowing(!!d.relationship?.following); } })
      .catch((e) => live && setError({ status: e.response?.status, message: errorMessage(e) }));
    return () => { live = false; };
  }, [username, version]);

  if (error) {
    return error.status === 404
      ? <Empty icon={UserRound} title="Profile not found" hint="This account doesn't exist or isn't available to you." action={<Link to="/" className="btn-primary mt-2">Back to home</Link>} />
      : <ErrorState message={error.message} onRetry={() => setVersion((v) => v + 1)} />;
  }
  if (!data) return <div className="space-y-4"><Skeleton className="h-56 w-full" /><Skeleton className="h-24 w-full" /></div>;

  const { user, relationship: rel = {}, counts = {} } = data;
  const isMe = !!rel.isMe;
  const setImg = (k) => (url) => { setData((d) => ({ ...d, user: { ...d.user, [k]: url } })); if (isMe) dispatch(userUpdated({ [k]: url })); };
  const toggleFollow = async () => {
    try { following ? await friendApi.unfollow(user._id) : await friendApi.follow(user._id); setFollowing(!following); setData((d) => ({ ...d, counts: { ...d.counts, followers: Math.max(0, (d.counts.followers || 0) + (following ? -1 : 1)) } })); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const startChat = async () => {
    try { const c = await messageApi.open(user._id); navigate(`/messages/${c._id}`); } catch (e) { toast(errorMessage(e), 'error'); }
  };
  const block = async () => { await profileApi.block(user._id); toast(`Blocked ${user.name}`, 'success'); navigate('/'); };

  const TABS = ['posts', 'about', 'friends', 'photos', 'tagged'];
  const tab = TABS.includes(tabParam) ? tabParam : 'posts';
  const setTab = (id) => navigate(id === 'posts' ? `/u/${user.username}` : `/u/${user.username}/${id}`);
  const tabs = [{ id: 'posts', label: 'Posts' }, { id: 'about', label: 'About' }, { id: 'friends', label: `Friends${counts.friends != null ? ` · ${counts.friends}` : ''}` }, { id: 'photos', label: 'Photos' }, { id: 'tagged', label: 'Tagged' }];

  return (
    <div className="space-y-4">
      <div className="card overflow-hidden">
        <div className="relative h-40 bg-gradient-to-br from-brand-500 to-fuchsia-500 sm:h-60">
          {user.cover && <img src={user.cover} alt="" className="h-full w-full object-cover" />}
          {isMe && (
            <ImageUpload kind="cover" current={user.cover} onDone={setImg('cover')}>
              {({ open, busy, remove }) => (
                <div className="absolute bottom-3 right-3 flex gap-2">
                  {remove && <button className="rounded-lg bg-black/55 px-3 py-1.5 text-xs font-semibold text-white" onClick={remove}>Remove</button>}
                  <button className="flex items-center gap-1.5 rounded-lg bg-surface/90 px-3 py-1.5 text-xs font-semibold shadow" onClick={open} disabled={busy}>{busy ? <Spinner className="h-3.5 w-3.5" /> : <Camera className="h-4 w-4" />}Edit cover</button>
                </div>)}
            </ImageUpload>
          )}
        </div>
        <div className="px-4 pb-4 sm:px-6">
          <div className="-mt-12 flex flex-col gap-3 sm:-mt-16 sm:flex-row sm:items-start">
            <div className="relative w-fit rounded-full ring-4 ring-surface">
              <Avatar user={user} size={112} />
              {isMe && (
                <ImageUpload kind="avatar" current={user.avatar} onDone={setImg('avatar')}>
                  {({ open, busy }) => <button className="absolute bottom-1 right-1 rounded-full bg-surface p-2 shadow ring-1 ring-line" aria-label="Change profile photo" onClick={open} disabled={busy}>{busy ? <Spinner className="h-4 w-4" /> : <Camera className="h-4 w-4" />}</button>}
                </ImageUpload>
              )}
            </div>
            <div className="min-w-0 flex-1 sm:pt-[4.5rem]">
              <h1 className="truncate text-2xl font-extrabold">{user.name} <Verified user={user} /></h1>
              <p className="text-sm text-mute">@{user.username} · {compact(counts.followers || 0)} followers · {compact(counts.following || 0)} following</p>
            </div>
            <div className="flex flex-wrap items-center gap-2 sm:pt-[4.5rem]">
              {isMe ? <button className="btn-primary" onClick={() => setEdit(true)}><Pencil className="h-4 w-4" />Edit profile</button> : (
                <>
                  {!rel.blocked && <button className="btn-soft" onClick={startChat}><MessageCircle className="h-4 w-4" />Message</button>}
                  {!rel.blocked && <FriendActions key={`${user._id}${rel.friendship}`} userId={user._id} initial={rel.friendship} requestId={rel.requestId} />}
                  {!rel.blocked && <button className="btn-soft" onClick={toggleFollow}>{following ? <BellOff className="h-4 w-4" /> : <Bell className="h-4 w-4" />}{following ? 'Following' : 'Follow'}</button>}
                  <Menu label="Profile actions" trigger={<span className="px-1 text-lg leading-none">⋯</span>} items={[
                    { label: 'Report profile', icon: Flag, onClick: () => setReport(true) },
                    { label: rel.restricted ? 'Unrestrict' : 'Restrict', icon: VolumeX, onClick: async () => { try { rel.restricted ? await profileApi.unblock(user._id) : await profileApi.block(user._id, 'restrict'); setVersion((v) => v + 1); } catch (e) { toast(errorMessage(e), 'error'); } } },
                    { label: `Block ${user.name.split(' ')[0]}`, icon: Ban, danger: true, onClick: () => setConfirmBlock(true) },
                  ]} />
                </>
              )}
            </div>
          </div>
          {user.bio && <p className="mt-3 whitespace-pre-wrap text-[15px]">{user.bio}</p>}
        </div>
        <div className="px-2"><Tabs value={tab} onChange={setTab} tabs={tabs} /></div>
      </div>

      {data.restricted ? <Empty icon={Lock} title="This profile is private" hint="Only friends can see this person's posts and details." /> : (
        <>
          {tab === 'posts' && <ProfilePosts data={data} isMe={isMe} kind="all" />}
          {tab === 'tagged' && <ProfilePosts data={data} isMe={isMe} kind="tagged" />}
          {tab === 'about' && <About user={user} about={data.about} counts={counts} isMe={isMe} onEdit={() => setEdit(true)} />}
          {tab === 'friends' && <FriendsTab userId={user._id} visible={isMe || data.friendsVisible} />}
          {tab === 'photos' && <PhotoGrid userId={user._id} kind="photos" />}
        </>
      )}

      {edit && <EditProfileModal open onClose={() => setEdit(false)} user={user} about={data.about} onSaved={() => { setVersion((v) => v + 1); profileApi.get(me.username).then((d) => dispatch(userUpdated({ name: d.user.name, bio: d.user.bio }))).catch(() => {}); }} />}
      {report && <ReportModal open onClose={() => setReport(false)} targetType="user" target={user._id} />}
      <ConfirmDialog open={confirmBlock} danger title={`Block ${user.name}?`} message="You won't see each other's profiles or posts, and any friendship or follows will be removed." confirmLabel="Block" onClose={() => setConfirmBlock(false)} onConfirm={block} />
    </div>
  );
}
