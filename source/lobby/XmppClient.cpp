#include "precompiled.h"
#include "XmppClient.h"
#include "GameItemData.h"

//debug
#include <iostream>

//Gloox
#include <gloox/rostermanager.h>
#include <gloox/rosteritem.h>
#include <gloox/error.h>

//Game - script
#include "scriptinterface/ScriptInterface.h"

//Configuration
#include "ps/ConfigDB.h"

using namespace gloox;

//global
XmppClient *g_XmppClient = NULL;

//debug
#if 1
#define DbgXMPP(x)
#else
#define DbgXMPP(x) std::cout << x << std::endl;
#endif

//Hack
#if 1
#if OS_WIN 
const std::string gloox::EmptyString = "";
#endif
#endif

//utils
std::string StanzaErrorToString(StanzaError& err)
{
  std::string msg;
#define CASE(X, Y) case X: return Y;
  switch (err)
  {
    CASE(StanzaErrorBadRequest, "Bad request")
    CASE(StanzaErrorConflict, "Player name already used")
    CASE(StanzaErrorFeatureNotImplemented, "Feature not implemented")
    CASE(StanzaErrorForbidden, "Forbidden")
    CASE(StanzaErrorGone, "Recipient or server gone")
    CASE(StanzaErrorInternalServerError, "Internal server error")
    CASE(StanzaErrorItemNotFound, "Item not found")
    CASE(StanzaErrorJidMalformed, "Jid malformed")
    CASE(StanzaErrorNotAcceptable, "Not acceptable")
    CASE(StanzaErrorNotAllowed, "Not allowed")
    CASE(StanzaErrorNotAuthorized, "Not authorized")
    CASE(StanzaErrorNotModified, "Not modified")
    CASE(StanzaErrorPaymentRequired, "Payment required")
    CASE(StanzaErrorRecipientUnavailable, "Recipient unavailable")
    CASE(StanzaErrorRedirect, "Redirect")
    CASE(StanzaErrorRegistrationRequired, "Registration required")
    CASE(StanzaErrorRemoteServerNotFound, "Remote server not found")
    CASE(StanzaErrorRemoteServerTimeout, "Remote server timeout")
    CASE(StanzaErrorResourceConstraint, "Resource constraint")
    CASE(StanzaErrorServiceUnavailable, "Service unavailable")
    CASE(StanzaErrorSubscribtionRequired, "Subscribtion Required")
    CASE(StanzaErrorUndefinedCondition, "Undefined condition")
    CASE(StanzaErrorUnexpectedRequest, "Unexpected request")
    CASE(StanzaErrorUnknownSender, "Unknown sender") 
    default:
      return "Error undefined";
  }
#undef CASE
}

XmppClient::XmppClient(ScriptInterface& scriptInterface, std::string sUsername, std::string sPassword, std::string sRoom, std::string sNick, bool regOpt)
  : m_ScriptInterface(scriptInterface), _client(NULL), _mucRoom(NULL), _registration(NULL), _username(sUsername), _password(sPassword), _nick(sNick)
{
  // Read lobby configuration from default.cfg
  std::string sServer;
  std::string sXpartamupp;
  CFG_GET_VAL("lobby.server", String, sServer);
  CFG_GET_VAL("lobby.xpartamupp", String, sXpartamupp);

  _xpartamuppId = sXpartamupp+std::string("@")+sServer+std::string("/CC");
  JID clientJid(sUsername+std::string("@")+sServer+std::string("/0ad"));
  JID roomJid(sRoom+std::string("@conference.")+sServer+std::string("/")+sNick);

  // If we are connecting, use the full jid and a password
  // If we are registering, only use the server name
  if(!regOpt)
    _client = new Client(clientJid, sPassword);
  else
    _client = new Client(sServer);

  _client->registerConnectionListener( this );
  _client->setPresence(Presence::Available, -1);
  _client->disco()->setVersion( "TestProg", "1.0" );
  _client->disco()->setIdentity( "client", "bot" );
  _client->setCompression(false);

  _client->registerStanzaExtension( new GameListQuery() );
  _client->registerIqHandler( this, ExtGameListQuery);

  _client->registerMessageHandler( this );

  StringList ca;
  ca.push_back( "/path/to/cacert.crt" );
  _client->setCACerts( ca );

  // Uncomment to see the raw stanzas
  //_client->logInstance().registerLogHandler( LogLevelDebug, LogAreaAll, this );

  if (!regOpt)
  {
    // Create a Multi User Chat Room
    _mucRoom = new MUCRoom(_client, roomJid, this, 0);
    // Disable the history because its anoying
    _mucRoom->setRequestHistory(0, MUCRoom::HistoryMaxStanzas);
  }
  else
  {
    // Registration
    _registration = new Registration( _client );
    _registration->registerRegistrationHandler( this );
  }
}

XmppClient::~XmppClient()
{
  DbgXMPP("XmppClient destroyed");
  delete _registration;
  delete _mucRoom;
  delete _client;
}

// Game - script
ScriptInterface& XmppClient::GetScriptInterface()
{
  return m_ScriptInterface;
}

//Network
void XmppClient::connect()
{
  _client->connect(false);
}

void XmppClient::disconnect()
{
  _client->disconnect();
}

void XmppClient::recv()
{
  _client->recv(1);
}

/*
 *  MUC Handlers
 */
void XmppClient::handleMUCParticipantPresence(gloox::MUCRoom*, gloox::MUCRoomParticipant participant, const gloox::Presence& presence)
{  
  //std::string jid = participant.jid->full();
  std::string nick = participant.nick->resource();
  gloox::Presence::PresenceType presenceType = presence.presence();
  if (presenceType == Presence::Unavailable)
  {
    DbgXMPP(nick << " left the room");
    m_PlayerMap.erase(nick);
  }
  else
  {
    DbgXMPP(nick << " is in the room, presence : " << (int)presenceType);
    m_PlayerMap[nick] = std::pair<std::string, int>(nick, (int)presenceType);
  }
  CreateSimpleMessage("system", "playerlist updated", "internal");
}

void XmppClient::handleMUCMessage( MUCRoom*, const Message& msg, bool )
{
  DbgXMPP(msg.from().resource() << " said " << msg.body());
  std::string nick = msg.from().resource();
  std::string body = msg.body();

  CScriptValRooted message;
  GetScriptInterface().Eval("({ 'type':'mucmessage'})", message);
  GetScriptInterface().SetProperty(message.get(), "from", nick);
  GetScriptInterface().SetProperty(message.get(), "text", body);
  PushGuiMessage(message);
}

void XmppClient::handleMUCError(gloox::MUCRoom*, gloox::StanzaError err)
{
  std::string msg = StanzaErrorToString(err);
  CreateSimpleMessage("system", msg, "error");
}

void XmppClient::handleMUCItems( MUCRoom * /*room*/, const Disco::ItemList& items )
{
  m_PlayerMap.clear();

  // Add the received items
  Disco::ItemList::const_iterator it = items.begin();
  for( ; it != items.end(); ++it )
  {
    std::string jid = (*it)->jid().full().c_str();
    std::string nick = (*it)->name().c_str();
    m_PlayerMap[nick] = std::pair<std::string, int>(nick, Presence::Available);
    //printf( "%s -- %s is an item here\n", (*it)->jid().full().c_str(), (*it)->name().c_str() );
  }
  CreateSimpleMessage("system", "playerlist updated", "internal");
}

/*
 *  Log (debug) Handler
 */
void XmppClient::handleLog( LogLevel level, LogArea area, const std::string& message )
{
  std::cout << "log: level: " <<  level << ", area: " << area << ", message: " << message << std::endl;
}

/*
 *  IQ Handler
 */
bool XmppClient::handleIq( const IQ& iq )
{
  DbgXMPP("handleIq [" << iq.tag()->xml() << "]");

  if(iq.subtype() == gloox::IQ::Result)
  {
    const GameListQuery* q = iq.findExtension<GameListQuery>( ExtGameListQuery );
    if(q)
    {
      m_GameList.clear();
      std::list<GameItemData*>::const_iterator it = q->gameList().begin();
      for(; it != q->gameList().end(); ++it)
      {
        m_GameList.push_back(**it);
      }
      CreateSimpleMessage("system", "gamelist updated", "internal");
    }
  }
  else if(iq.subtype() == gloox::IQ::Error)
  {
    StanzaError err = iq.error()->error();
    std::string msg = StanzaErrorToString(err);
    CreateSimpleMessage("system", msg, "error");
  }
  else
  {
    CreateSimpleMessage("system", std::string("unknown subtype : ") + iq.tag()->name(), "error");
  }

  return true;
}

/*
 *  Connection Handlers
 */
void XmppClient::onConnect()
{
  if (_mucRoom)
  {
    CreateSimpleMessage("system", "connected");
    _mucRoom->join();
    //_mucRoom->getRoomInfo();
    _mucRoom->getRoomItems();
    SendIqGetGameList();
  }

  if (_registration)
  {
    _registration->fetchRegistrationFields();
  }
}

void XmppClient::onDisconnect( ConnectionError e )
{
  // Make sure we properly leave the room so than
  // everything work if we decide to come back later
  if (_mucRoom)
    _mucRoom->leave();

  if( e == ConnAuthenticationFailed )
    CreateSimpleMessage("system", "authentication failed", "error");
  else
    CreateSimpleMessage("system", "disconnected");

  m_PlayerMap.clear();
  m_GameList.clear();
}

bool XmppClient::onTLSConnect( const CertInfo& )
{
  return true;
}

/*
 *  Requests
 */

/* Request GameList from cloud */
void XmppClient::SendIqGetGameList()
{
  JID xpartamuppJid(_xpartamuppId);

  // Send IQ
  IQ iq(gloox::IQ::Get, xpartamuppJid);
  iq.addExtension( new GameListQuery() );
  DbgXMPP("SendIqGetGameList [" << iq.tag()->xml() << "]");
  _client->send(iq);
}

/* Register a game */
void XmppClient::SendIqRegisterGame(CScriptVal data)
{
  JID xpartamuppJid(_xpartamuppId);

  std::string name, mapName, mapSize, victoryCondition, nbp, tnbp;
  GetScriptInterface().GetProperty(data.get(), "name", name);
  GetScriptInterface().GetProperty(data.get(), "mapName", mapName);
  GetScriptInterface().GetProperty(data.get(), "mapSize", mapSize);
  GetScriptInterface().GetProperty(data.get(), "victoryCondition", victoryCondition);
  GetScriptInterface().GetProperty(data.get(), "nbp", nbp);
  GetScriptInterface().GetProperty(data.get(), "tnbp", tnbp);

  // Send IQ
  GameListQuery* g = new GameListQuery();
  g->m_command = "register";
  /* This "x" fake ip will be overwritten by the ip stamp XMPP module */
  GameItemData *pItemData = new GameItemData(name, "x");
  pItemData->m_mapName = mapName;
  pItemData->m_mapSize = mapSize;
  pItemData->m_victoryCondition = victoryCondition;
  pItemData->m_nbp = nbp;
  pItemData->m_tnbp = tnbp;
  g->m_gameList.push_back( pItemData );

  IQ iq(gloox::IQ::Set, xpartamuppJid);
  iq.addExtension( g );
  DbgXMPP("SendIqRegisterGame [" << iq.tag()->xml() << "]");
  _client->send(iq);
}

/* Unregister a game */
void XmppClient::SendIqUnregisterGame(std::string name)
{
  JID xpartamuppJid(_xpartamuppId);

  // Send IQ
  GameListQuery* g = new GameListQuery();
  g->m_command = "unregister";
  g->m_gameList.push_back( new GameItemData(name) );

  IQ iq(gloox::IQ::Set, xpartamuppJid);
  iq.addExtension( g );
  DbgXMPP("SendIqUnregisterGame [" << iq.tag()->xml() << "]");
  _client->send(iq);
}

/*
 *  Registration
 */
void XmppClient::handleRegistrationFields( const JID& /*from*/, int fields, std::string )
{
  RegistrationFields vals;
  vals.username = _username;
  vals.password = _password;
  _registration->createAccount( fields, vals );
}

void XmppClient::handleRegistrationResult( const JID& /*from*/, RegistrationResult result )
{
  if (result == gloox::RegistrationSuccess)
  {
    CreateSimpleMessage("system", "registered");
  }
  else
  {
    std::string msg;
#define CASE(X, Y) case X: msg = Y; break;
    switch(result)
    {
      CASE(RegistrationNotAcceptable, "Registration not acceptable")
      CASE(RegistrationConflict, "Registration conflict")
      CASE(RegistrationNotAuthorized, "Registration not authorized")
      CASE(RegistrationBadRequest, "Registration bad request")
      CASE(RegistrationForbidden, "Registration forbidden")
      CASE(RegistrationRequired, "Registration required")
      CASE(RegistrationUnexpectedRequest, "Registration unexpected request")
      CASE(RegistrationNotAllowed, "Registration not allowed")
      default: msg = "Registration unknown error";
    }
#undef CASE
    CreateSimpleMessage("system", msg, "error");
  }
  disconnect();
}

void XmppClient::handleAlreadyRegistered( const JID& /*from*/ )
{
  DbgXMPP("the account already exists");
}

void XmppClient::handleDataForm( const JID& /*from*/, const DataForm& /*form*/ )
{
  DbgXMPP("dataForm received");
}

void XmppClient::handleOOB( const JID& /*from*/, const OOB& /* oob */ )
{
  DbgXMPP("OOB registration requested");
}

/**
  * Message
  */
void XmppClient::handleMessage( const Message& msg, MessageSession * /*session*/ )
{
  DbgXMPP("type " << msg.subtype() << ", subject " << msg.subject().c_str() 
    << ", message " << msg.body().c_str() << ", thread id " << msg.thread().c_str());

  std::string nick = msg.from().resource();
  std::string body = msg.body();

  CScriptValRooted message;
  GetScriptInterface().Eval("({ 'type':'message'})", message);
  GetScriptInterface().SetProperty(message.get(), "from", nick);
  GetScriptInterface().SetProperty(message.get(), "text", body);
  PushGuiMessage(message);
}



/* Requests from GUI */
CScriptValRooted XmppClient::GUIGetPlayerList()
{
  std::string presence;
  CScriptValRooted playerList;
  GetScriptInterface().Eval("({})", playerList);
  for(std::map<std::string, std::pair<std::string, int> >::iterator it = m_PlayerMap.begin(); it != m_PlayerMap.end(); ++it)
  {
    CScriptValRooted player;
    switch(it->second.second)
    {
      case Presence::Available:
        presence = "available";
        break;
      case Presence::DND:
        presence = "playing";
        break;
    }
    GetScriptInterface().Eval("({})", player);
    GetScriptInterface().SetProperty(player.get(), "name", it->second.first.c_str());
    GetScriptInterface().SetProperty(player.get(), "presenceType", presence.c_str());

    GetScriptInterface().SetProperty(playerList.get(), it->second.first.c_str(), player);
  }

  return playerList;
}

CScriptValRooted XmppClient::GUIGetGameList()
{
  CScriptValRooted gameList;
  GetScriptInterface().Eval("([])", gameList);
  for(std::list<GameItemData>::iterator it = m_GameList.begin(); it !=m_GameList.end(); ++it)
  {
    CScriptValRooted game;
    GetScriptInterface().Eval("({})", game);

#define ITEM(param)\
    GetScriptInterface().SetProperty(game.get(), #param, it->m_##param .c_str());
    ITEMS
#undef ITEM

    GetScriptInterface().CallFunctionVoid(gameList.get(), "push", game);
  }

  return gameList;
}

/* Messages */
CScriptValRooted XmppClient::GuiPollMessage()
{
  if (m_GuiMessageQueue.empty())
    return CScriptValRooted();

  CScriptValRooted r = m_GuiMessageQueue.front();
  m_GuiMessageQueue.pop_front();
  return r;
}

void XmppClient::SendMUCMessage(std::string message)
{
  _mucRoom->send(message);
}

void XmppClient::PushGuiMessage(const CScriptValRooted& message)
{
  ENSURE(!message.undefined());

  m_GuiMessageQueue.push_back(message);
}

void XmppClient::CreateSimpleMessage(std::string type, std::string text, std::string level)
{
  CScriptValRooted message;
  GetScriptInterface().Eval("({})", message);
  GetScriptInterface().SetProperty(message.get(), "type", type);
  GetScriptInterface().SetProperty(message.get(), "level", level);
  GetScriptInterface().SetProperty(message.get(), "text", text);
  PushGuiMessage(message);
}

void XmppClient::SetPresence(std::string presence)
{
  if(presence.compare("available") == 0)
  {
    _mucRoom->setPresence(Presence::Available);
  }
  else if(presence.compare("playing") == 0) 
  {
    _mucRoom->setPresence(Presence::DND);
  }
}

/*
 *  GameListQuery, custom IQ Stanza
 */

GameListQuery::GameListQuery( const Tag* tag )
: StanzaExtension( ExtGameListQuery )
{
  if( !tag || tag->name() != "query" || tag->xmlns() != XMLNS_GAMELIST )
    return;

  const Tag* c = tag->findTag( "query/game" );
  if (c)
    m_command = c->cdata();

  const ConstTagList& l = tag->findTagList( "query/game" );
  ConstTagList::const_iterator it = l.begin();
  for( ; it != l.end(); ++it )
  {
    GameItemData *pItem = new GameItemData();
#define ITEM(param)\
    const std::string param = (*it)->findAttribute( #param ); \
    pItem->m_##param = param;
    ITEMS
#undef ITEM
    m_gameList.push_back( pItem );
  }
}

GameListQuery::~GameListQuery()
{
  util::clearList( m_gameList );
}

const std::string& GameListQuery::filterString() const
{
  static const std::string filter = "/iq/query[@xmlns='" + XMLNS_GAMELIST + "']";
  return filter;
}

Tag* GameListQuery::tag() const
{
  Tag* t = new Tag( "query" );
  t->setXmlns( XMLNS_GAMELIST );
/*
  RosterData::const_iterator it = m_roster.begin();
  for( ; it != m_roster.end(); ++it )
  t->addChild( (*it)->tag() );
*/

  // register / unregister command
  if(!m_command.empty())
    t->addChild(new Tag("command", m_command));

  std::list<GameItemData*>::const_iterator it = m_gameList.begin();
  for( ; it != m_gameList.end(); ++it )
    t->addChild( (*it)->tag() );

  return t;
}

StanzaExtension* GameListQuery::clone() const
{
  GameListQuery* q = new GameListQuery();

  return q;
}

const std::list<GameItemData*>& GameListQuery::gameList() const
{
  return m_gameList;
}
