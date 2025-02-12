-module(mod_ipstamp).

-behaviour(gen_mod).

-include("ejabberd.hrl").

-export([start/2, stop/1, on_filter_packet/1]).

%% Domain on which run the ejabberd server
-define (Domain, "0ad.mikoton.com").

%% Login of the Xpartamupp jabber client
-define (XpartamuppLogin, "xpartamupp").

start(_Host, _Opts) ->
    ?INFO_MSG("mod_ipip starting", []),
    ejabberd_hooks:add(filter_packet, global, ?MODULE, on_filter_packet, 50),
    ok.

stop(_Host) ->
    ejabberd_hooks:delete(filter_packet, global, ?MODULE, on_filter_packet, 50),
    ok.

on_filter_packet({From, To, Packet} = Input) ->
    {_,STo,_,_,_,_,_} = To,
    {_,SFrom,_,_,_,_,_} = From,
    if STo == "xpartamupp" ->
      {_,SElement,LPacketInfo,LPacketQuery} = Packet,
      if SElement == "iq" -> 
        {_, SType} = lists:keyfind("type",1,LPacketInfo),
        if SType == "set" ->
          {_,_,LXmlns,LGame} = lists:keyfind("query",2,LPacketQuery),
          {_,SXmlns} = lists:keyfind("xmlns",1,LXmlns),
          if SXmlns == "jabber:iq:gamelist" ->
            {_,_,_,LCommand} = lists:keyfind("command",2,LGame),
            {_,SCommand} = lists:keyfind(xmlcdata,1,LCommand),
            if SCommand == <<"register">> ->
              {_,_,KGame,_} = lists:keyfind("game",2,LGame),
              Info = ejabberd_sm:get_user_info(SFrom,[?Domain],"0ad"),
              {ip, {Ploc, _Port}} = lists:keyfind(ip, 1, Info),
              SIp = inet_parse:ntoa(Ploc),
              ?INFO_MSG(string:concat("stamp ip: ",SIp), []),
              {From,To,{xmlelement,"iq",LPacketInfo,[
                {xmlelement,"query",[{"xmlns","jabber:iq:gamelist"}],[
                  {xmlelement,"game",lists:keyreplace("ip",1,KGame,{"ip",SIp}),[]},
                  {xmlelement,"command",[],[{xmlcdata,<<"register">>}]}
                  ]
                }
              ]}}
            ; true -> Input
            end 
          ; true -> Input
          end
        ; true -> Input
        end
      ; true -> Input
      end
    ; true -> Input 
    end.


