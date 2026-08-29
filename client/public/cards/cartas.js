// Arquivo central de cartas para Mytragor
// Adicione novas cartas neste array!

const CARD_DEFS = [
  // --- Escolhidos / Líderes ---
  {
    name: 'Valbrak, O Mago Popular',
    aliases: ['Valbrak, Heroi do Povo'],
    key: 'valbrak',
    kind: 'leader',
    img: '/chosens/layout-valbrak.ai.png',
    classe: 'Mago',
    tipo: 'Anão',
    filiacao: 'Arcana',
    hp: 30,
    maxHp: 30,
    effectA: 'valbrak',
    effectB: 'valbrak_citizen_boost',
    effect: 'valbrak',
    text: '• Uma vez por turno, quando você convocar um aliado\n"Cidadão", compre 1 carta.\n\n• Uma vez por turno, você pode pagar 2 fragmentos\nativos, seus aliados "Cidadão" recebem +1 de Ataque\naté o final do turno.'
  },
  {
    name: 'Katsu, o Vingador',
    key: 'katsu',
    kind: 'leader',
    img: '/chosens/layout-katsuvingador.ai.png',
    classe: 'Guerreiro',
    tipo: 'Humano',
    filiacao: 'Marcial',
    hp: 30,
    maxHp: 30,
    effectA: 'katsu',
    effectB: 'katsu_warrior_burn',
    effect: 'katsu',
    text: '• Aliados "Guerreiro" que você controla, podem atacar\ninimigos que estejam Dispostos.\n\n• Uma vez por turno, se um Aliado "Guerreiro" derrotar\num personagem inimigo, em combate, cause 2 de dano\nao Escolhido inimigo.'
  },
  {
    name: 'Leafae, Guardião da Floresta',
    key: 'leafae',
    kind: 'leader',
    img: '/chosens/layout-leafaefloresta.ai.png',
    classe: 'Druida',
    tipo: 'Elfo',
    filiacao: 'Religioso',
    hp: 30,
    maxHp: 30,
    effectA: 'leafae',
    effectB: 'leafae_vital_guard',
    effect: 'leafae',
    text: '• Sempre que um Aliado que você controla for curado,\ncoloque um marcador "Elo Vital" neste Escolhido.\n\n• Uma vez por turno, você pode remover 3 marcadores\n"Elo Vital" deste Escolhido, então cure 2 de vida de um\nAliado em campo.'
  },
  {
    name: 'Ademais, Aranhas Negras',
    key: 'ademais',
    kind: 'leader',
    img: '/chosens/layout-ademais.ai.png',
    classe: 'Clérigo',
    tipo: 'Humano',
    filiacao: 'Sombras',
    hp: 30,
    maxHp: 30,
    effectA: 'ademais_spider_mark',
    effectB: 'ademais_spider_burst',
    effect: 'ademais_spider_mark',
    text: '• Quando um Aliado "Aranhas Negras" for convocado,\neste Escolhido recebe um marcador "Aranhas".\n\n• Uma vez por turno, você pode remover 4 marcadores\n"Aranhas" deste Escolhido, então cause 3 de dano ao\nEscolhido inimigo.'
  },
    // Nota: recebeu stats padrão para ser alvo de ataques/efeitos.
  // Exemplos de outras cartas (adicione todas as cartas reais aqui)
  {
  name: 'Cervo de Galhos Brancos', key: 'cervo_ga_brancos', aliases: ['Cervo dos Galhos Brancos', 'cervo de galhos brancos', 'cervo dos galhos brancos'], kind: 'ally', img: '/allies/layout-cervogalhosbrancos.ai.png', cost: 3, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'curar_animal', effectValue: 1, text: 'Quando este Aliado for convocado, cure 1 de vida de\noutro Aliado "Animal" no seu campo.'
  },
{
  name: 'Cão de Caça Feroz', kind: 'ally', img: '/allies/layout-caocacaferoz.ai.png', cost: 4, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 4, maxHp: 4, damage: 4, atkBonus: 4, keywords: ['investida'], text: 'Investida— Este personagem pode atacar no turno que\nfoi convocado.'
},
  {
  name: 'Jabuti Barreira', kind: 'ally', img: '/allies/layout-jabutibarreira.ai.png', cost: 4, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 1, hp: 8, maxHp: 8, damage: 1, atkBonus: 1, keywords: ['bloquear'], text: 'Interpor — Este personagem pode bloquear um ataque\ndirecionado a outro personagem.'
  },
  // Carta de teste: Aranhas Negras (aliado de teste)
  {
    name: 'Aranhas Negras, Agiota', kind: 'ally', img: '/allies/layout-agiota.ai.png', cost: 3, classe: 'Ladino', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'agiota', text: 'Uma vez por turno, você pode causar 2 de dano neste\nAliado, então pode jogar uma carta custo 2 ou menos da\nsua mão, sem pagar seu custo em fragmentos.'
  },
  {
    name: 'Aranhas Negras, Novato', kind: 'ally', img: '/allies/layout-aranhasnovato.ai.png', cost: 1, classe: 'Ladino', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], text: ''
  },
  {
    name: 'Aranhas Negras, Novato', key: 'token_aranhas', kind: 'ally', img: '/tokens/layout-aranhastoken.ai.png', cost: 1, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 1, hp: 1, maxHp: 1, damage: 1, atkBonus: 1, keywords: [], text: 'Token.'
  },
  {
    name: 'Cidadãos Unidos', key: 'token_povo', kind: 'ally', img: '/tokens/layout-cidadaotoken.ai.png', cost: 0, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Arcana', ac: 1, hp: 1, maxHp: 1, damage: 1, atkBonus: 1, keywords: [], text: 'Token.'
  },
	{
    name: 'Aranhas Negras, Mascote', kind: 'ally', img: '/allies/layout-aranhasmascote.ai.png', cost: 7, classe: 'Criatura', tipo: 'Animal', filiacao: 'Sombras', ac: 0, hp: 5, maxHp: 5, damage: 3, atkBonus: 3, keywords: [], effect: 'aranhas_mascote', text: 'Quando este Aliado for convocado, crie até 2 Totens\n"Aranhas Negras", Criatura, Animal, vida 1, ataque 1 e\nResistência 1.'
  },
  {
    name: 'Gladiador Aposentado', kind: 'ally', img: '/allies/layout-gladiadoraposentado.ai.png', cost: 7, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Neutra', ac: 2, hp: 8, maxHp: 8, damage: 6, atkBonus: 6, keywords: [], text: ''
  },
  {
    name: 'Aranhas Negras, Executor', kind: 'ally', img: '/allies/layout-aranhasexecutor.ai.png', cost: 5, classe: 'Ladino', tipo: 'Humano', filiacao: 'Sombras', ac: 1, hp: 6, maxHp: 6, damage: 3, atkBonus: 3, keywords: [],
    // Ao entrar, permite banir uma carta; também fornece aura de +1 ATK a aliados com "Aranhas Negras" no nome
    effect: 'ban_on_enter', effectValue: 1, auraTarget: { nameIncludes: 'Aranhas Negras' }, auraScope: 'allies', auraProp: 'atk', text: 'Quando este Aliado for convocado, você pode deslocar\numa carta em campo.\nAliados com "Aranhas Negras" no nome, que você\ncontrola, recebe +1 de ataque.'
  },
  {
    name: 'Goblin Sabotador', kind: 'ally', img: '/allies/layout-goblinsabotador.ai.png', cost: 3, classe: 'Ladino', tipo: 'Humanóide', filiacao: 'Neutra', ac: 1, hp: 4, maxHp: 4, damage: 2, atkBonus: 2, keywords: [], effect: 'destroy_equip_on_enter', text: 'Quando este Aliado for convocado, você pode destruir 1\nEquipamento no campo do oponente.'
  },
  {
  name: 'Thorn, o Martelo da Montanha', kind: 'ally', img: '/allies/layout-thornmartelomontanha.ai.png', cost: 7, classe: 'Guerreiro', tipo: 'Anão', filiacao: 'Neutra', ac: 1, hp: 8, maxHp: 8, damage: 6, atkBonus: 6, keywords: ['atropelar'], effect: '', text: 'Atropelar — O excesso de Dano em um combate,\natinge diretamente a vida do Escolhido do oponente.'
  },
 {
  name: 'Urso Negro', key: 'Urso Negro Tanque', kind: 'ally', img: '/allies/layout-ursonegro.ai.png', cost: 5, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 1, hp: 7, maxHp: 7, damage: 4, atkBonus: 4, keywords: [], effect: '', text: ''
 },
  {
    name: 'Bartolomeu, o Inspirador', kind: 'ally', img: '/allies/layout-bartolomeuinspirador.ai.png', cost: 4, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Arcana', ac: 1, hp: 5, maxHp: 5, damage: 2, atkBonus: 2, keywords: [], effect: 'chamar_cidadao', text: 'Quando este Aliado for derrotado em combate e\nenviado para o cemitério, você pode convocar um\naliado "Cidadão", com nome diferente deste, da sua\nmão, sem pagar o custo dele.', chamarEspecial: { classe: 'Cidadão', origem: ['hand'] }
  },
  {
      name: 'Batedor Kobold', kind: 'ally', img: '/allies/layout-batedorkobold.ai.png', cost: 1, classe: 'Cidadão', tipo: 'Humanoide', filiacao: 'Sombras', ac: 0, hp: 2, maxHp: 2, damage: 2, atkBonus: 2, keywords: [], effect: '', text: ''
  },
  {
  name: 'Aprendiz de Magia', kind: 'ally', img: '/allies/layout-aprendizmagia.ai.png', cost: 1, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], text: ''
  },
  {
  name: 'Gladiador Impenetrável', kind: 'ally', img: '/allies/layout-gladiadorimpenetravel.ai.png', cost: 4, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 1, hp: 7, maxHp: 7, damage: 1, atkBonus: 1, keywords: ['bloquear', 'provocar'], text: 'Interpor — Este personagem pode bloquear um ataque\ndirecionado a outro personagem.\nDesafio — Enquanto este aliado estiver Exaurido, seus\noponentes só podem atacar aliados com Desafio.'
  },
  {
  name: 'Gladiador Ousado', kind: 'ally', img: '/allies/layout-gladiadorousado.ai.png', cost: 4, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Neutra', ac: 1, hp: 6, maxHp: 6, damage: 3, atkBonus: 3, keywords: ['provocar'], text: 'Desafio — Enquanto este aliado estiver Exaurido, seus\noponentes só podem atacar aliados com Desafio.'
  },
  {
name: 'Tamanduá Guardião', kind: 'ally', img: '/allies/layout-tamanduaguardiao.ai.png', cost: 2, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 0, hp: 7, maxHp: 7, damage: 2, atkBonus: 2, keywords: ['provocar'], effect: '', text: 'Desafio — Enquanto este aliado estiver Exaurido, seus\noponentes só podem atacar aliados com Desafio.'
  },
    {
    name: 'Leão Rei Sagrado', kind: 'ally', img: '/allies/layout-leaoreisagrado.ai.png', cost: 6, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 1, hp: 5, maxHp: 5, damage: 4, atkBonus: 4, keywords: [], effect: 'search_deck_animal_aura_atk', effectValue: 1, auraTarget: { tipo: 'Animal' }, auraProp: 'atk', text: 'Quando este Aliado for convocado, adicione um aliado\n"Animal" do seu baralho para sua mão. Embaralhe seu\nbaralho.\n\nEnquanto este Aliado estiver em campo, seus Aliados\n"Animal" recebem +1 de Ataque.'
    },
  {
  name: 'Aerin Nieloy', kind: 'ally', img: '/allies/layout-aerynnieloy.ai.png', cost: 3, classe: 'Guerreiro', tipo: 'Elfo', filiacao: 'Marcial', ac: 1, hp: 6, maxHp: 6, damage: 2, atkBonus: 2, keywords: ['bloquear'],
    effect: 'aura_hp', effectValue: 1, auraTarget: { classe: 'Cidadão' }, auraScope: 'allies',
    text: 'Interpor — Este personagem pode bloquear um ataque\ndirecionado a outro personagem.\nEnquanto este aliado estiver em campo, seus\npersonagens "cidadão" recebem +1 de vida.'
  },

  {
  name: 'Informante do Beco', kind: 'ally', img: '/allies/layout-informantebeco.ai.png', cost: 2, classe: 'Cidadão', tipo: 'Elfo', filiacao: 'Neutra', ac: 1, hp: 3, maxHp: 3, damage: 2, atkBonus: 2, keywords: [], effect: 'informante_beco',text: 'Quando este Aliado for Convocado, revele a carta do\ntopo do baralho do oponente, depois volte a carta para\no topo.'
  },
  {
    name: 'Gamboa, a Caçadora',
    key: 'gamboa_selva',
    aliases: ['Gamboa, Arqueira da Selva'],
    kind: 'ally',
    img: '/allies/layout-gamboacacadora.ai.png',
    cost: 4,
    classe: 'Ladino',
    tipo: 'Elfo',
    filiacao: 'Neutra',
    ac: 0,
    hp: 4,
    maxHp: 4,
    damage: 3,
    atkBonus: 3,
    keywords: [],
    effect: 'discard_enemy_hand',
    text: 'Quando este Aliado for convocado, você pode olhar as\ncartas na mão do seu oponente. Escolha 1 carta na mão\ndele e descarte.'
  },
  {
  name: 'Miliciano da Vila', kind: 'ally', img: '/allies/layout-milicianovila.ai.png', cost: 2, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Neutra', ac: 0, hp: 2, maxHp: 2, damage: 2, atkBonus: 2, keywords: [], text: ''
  },
  {
  name: 'Charlatão da Vila', kind: 'ally', img: '/allies/layout-charlataovila.ai.png', cost: 2, classe: 'Cidadão', tipo: 'Elfo', filiacao: 'Arcana', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'charlatao_da_vila', text: 'Quando este Aliado for convocado, compre uma carta,\nem seguida descarte uma carta da sua mão. O efeito de\nCharlatão da Vila só pode ser ativado uma vez por turno'
  },
  {
  name: 'Estudante Arcano', kind: 'ally', img: '/allies/layout-estudantearcano.ai.png', cost: 1, classe: 'Mago', tipo: 'Elfo', filiacao: 'Arcana', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], effect: 'estudante_arcano', text: 'Quando este Aliado for convocado, você pode colocar\numa carta da sua mão no fundo do seu baralho. Se o\nfizer, compre 1 carta.'
  },
  {
  name: 'Xamã Kobold', kind: 'ally', img: '/allies/layout-xamakobold.ai.png', cost: 2, classe: 'Mago', tipo: 'Humanoide', filiacao: 'Sombras', ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1, keywords: [], effect: 'xama_kobold', text: 'Quando este Aliado for convocado, você pode Deslocar 1\nAliado, com "Kobold" no nome, que estiver no seu\ncemitério, depois compre 1 carta.'
  },
{
    name: 'Toupeira Escavadora', kind: 'ally', img: '/allies/layout-toupeiraescavadora.ai.png', cost: 1, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'olhar_topo', text: 'Quando este Aliado for convocado, olhe a carta do topo\ndo seu baralho, você deve colocá-la no fundo ou voltá-la\npara o topo do seu baralho.'
},
  {
    name: 'Porco-espinho Furioso', kind: 'ally', img: '/allies/layout-porcoespinhofurioso.ai.png', cost: 3, classe: 'Criatura', tipo: 'Animal', filiacao: 'Religioso', ac: 0, hp: 4, maxHp: 4, damage: 2, atkBonus: 2, keywords: [], effect: 'ally_heal_buff', text: 'Sempre que um personagem que você controla for\ncurado, coloque 1 marcador de "Elo Vital" neste Aliado.\neste Aliado recebe +1 de Ataque e +1 de Vida para cada\nmarcador de "Elo Vital" nele.'
  },
  {
    name: 'Hiena Carniceira', kind: 'ally', img: '/allies/layout-hienacarniceira.ai.png', cost: 3, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 4, maxHp: 4, damage: 3, atkBonus: 3, keywords: [],
    text: 'Quando este Aliado for derrotado em combate e\nenviado para o cemitério, escolha 1 Aliado, custo 3 ou\nmenos, no seu cemitério, que não seja "Hiena\nCarniceira", convoque-o para o campo.',
    // Configuração para o mecanismo genérico de "chamar especial" usado por outras cartas
    chamarEspecial: { origem: ['grave'], maxCost: 3 }
  },
  {
    name: 'Arnold, o Escudeiro', kind: 'ally', img: '/allies/layout-Arnoldescudeiro.ai.png',
    cost: 2,
    classe: 'Cidadão', tipo: 'Humano', filiacao: 'Marcial',
    ac: 1, hp: 4, maxHp: 4, damage: 2, atkBonus: 2,
    keywords: [], effect: 'search_deck', query: { kind: 'equip' }, max: 12, shuffleAfter: true,
    text: 'Quando este Aliado for convocado, procure no seu\nbaralho uma carta de equipamento e adicione à sua\nmão. Depois embaralhe seu baralho.'
  },
  {
    name: 'O Protetor', kind: 'ally', img: '/allies/layout-oprotetor.ai.png', cost: 3, classe: 'Cidadão', tipo: 'Humano', filiacao: 'Arcana', ac: 0, hp: 4, maxHp: 4, damage: 1, atkBonus: 1, keywords: ['bloquear'], effect: 'aura_hp', effectValue: 1, auraTarget: { classe: 'Cidadão' }, auraScope: 'allies', text: 'Interpor — Este personagem pode bloquear um ataque\ndirecionado a outro personagem.\nEnquanto este aliado estiver em campo, seus\npersonagens "Cidadão" recebem +1 de vida.'
  },
  {
    name: 'Gladiador Veloz', kind: 'ally', img: '/allies/layout-gladiadorveloz.ai.png', cost: 3, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 0, hp: 3, maxHp: 3, damage: 4, atkBonus: 4, keywords: ['investida'], text: 'Investida — Este personagem pode atacar no turno\nque foi convocado.'
  },

  // Magias, Equipamentos, Ambientes, Truques
  {
  name: 'Mãos Flamejantes', kind: 'spell', img: '/spell/layout-maosflamejantes.ai.png', cost: 2, classe: '', tipo: 'Magia', filiacao: 'Arcana', effect: 'dano_2_inimigo', text: 'Escolha 1 personagem em campo, cause 2 de Dano.'
  },
  {
    name: 'Espionagem Sorrateira', kind: 'spell', img: '/spell/layout-espionagemsorrateira.ai.png', cost: 4, classe: '', tipo: 'Magia', filiacao: 'Sombras', effect: 'espionagem_sorrateira',
    text: 'Olhe as cartas da mão do seu oponente. Escolha uma\ncarta "Religioso", "Marcial" e "Arcano" dentre elas e\ndescarte-a.'
  },
  {
    name: 'Profanação de Terreno', kind: 'spell', img: '/spell/layout-profanacaoterreno.ai.png', cost: 3, classe: '', tipo: 'Magia', filiacao: 'Neutra', effect: 'destroy_env',
    text: 'Destrua 1 Ambiente em campo.'
  },
  {
    name: 'Controle de Correntezas', kind: 'spell', img: '/spell/layout-controlecorrenteza.ai.png', cost: 4, classe: '', tipo: 'Magia', filiacao: 'Religioso', effect: 'destroy_enemy_ally',
    text: 'Destrua um Aliado do oponente em campo.'
  },
  {
    name: 'Ajuda do Povo', kind: 'spell', img: '/spell/layout-ajudapovo.ai.png', cost: 3, classe: '', tipo: 'Magia', filiacao: 'Arcana', effect: 'ajuda_do_povo',
    text: 'Convoque 2 Totens "Cidadãos Unidos" no seu lado do\ncampo. Eles são Cidadão, Humano, vida 1, Ataque 1 e\nResistência 1.'
  },
    {
      name: 'Contrição',
      kind: 'truque',
      img: '/trick/layout-constricaoll.ai.png',
      cost: 4,
      classe: '',
      tipo: 'Truque',
      filiacao: 'Religioso',
      effect: 'freeser',
      text: 'Quando um oponente declarar ataque: Negue esse\nataque. O personagem atacante permanece exaurido\naté o fim do próximo turno do controlador dele.'
    },
    {
      name: 'Aranhas Negras, Emboscada',
      kind: 'truque',
      img: '/trick/layout-aranhasemboscada.ai.png',
      cost: 3,
      classe: '',
      tipo: 'Truque',
      filiacao: 'Sombras',
      effect: 'aranhas_emboscada',
      effectValue: 3,
      text: 'Quando um oponente declarar um Ataque: O\npersonagem atacante perde 3 de Ataque até o final\ndaquele embate. Se você controlar um Aliado com\n"Aranhas Negras" no nome, compre 1 carta.'
    },
  {
    name: 'Interrupção Perfeita', kind: 'truque', img: '/trick/layout-interrupcaoperfeita.ai.png', cost: 2, classe: '', tipo: 'Truque', filiacao: 'Arcana', effect: 'anular_magia_truque', text: 'Quando seu oponente ativar uma carta de Magia ou\nTruque: Anule o efeito da carta ativada.'
  },
    {
      name: 'Alerta de Fuga',
      kind: 'truque',
      img: '/trick/layout-alertafuga.ai.png',
      cost: 2,
      classe: '',
      tipo: 'Truque',
      filiacao: 'Marcial',
      effect: 'bem_treinado',
      text: 'Quando um aliado do seu lado do for enviado para o\ncemitério: Escolha 1 aliado "Marcial" no seu cemitério\ne convoque-o para o campo.'
    },
  {
    name: 'Tempestade Arcana', kind: 'env', img: '/envs/layout-tempestadearcana.ai.png', cost: 3, classe: '', tipo: 'Ambiente', filiacao: 'Arcana', effect: 'arcana_draw', text: 'Enquanto esta carta estiver em campo, jogadores cujo\nEscolhido seja "Arcano", compram 1 carta adicional na\nFase Inicial. Este efeito não é opcional.'
  },
  {
    name: 'Caminhos Perigosos', kind: 'env', img: '/envs/layout-caminhosperigosos.ai.png', cost: 3, classe: '', tipo: 'Ambiente', filiacao: 'Sombras', effect: 'sombra_penalty', text: 'Enquanto esta carta estiver em campo, jogadores cujo\nEscolhido não seja "Sombras", têm 1 fragmento ativo a\nmenos.'
  },
  {
    name: 'Campos Ensanguentados', kind: 'env', img: '/envs/layout-camposensanguentados.ai.png', cost: 4, classe: '', tipo: 'Ambiente', filiacao: 'Marcial', effect: 'marcial_bonus', text: 'Enquanto esta carta estiver em campo, personagens\n"Marcial" recebem +1 de ataque.'
  },
  {
    name: 'Catedral Ensolarada', kind: 'env', img: '/envs/layout-catedralensolarada.ai.png', cost: 3, classe: '', tipo: 'Ambiente', filiacao: 'Religioso', effect: 'religioso_protecao', text: 'Durante a Fase Inicial, jogadores com Escolhido\n"Religioso", escolhem 1 Aliado em campo. O Aliado\nselecionado recebe +2 de vida até o início do próximo\nturno do jogador.'
  },
  {
    name: 'Lâmina Serralhada', kind: 'equip', img: '/equip/layout-laminaserrilhada.ai.png', cost: 2, classe: '', tipo: 'Equipamento', filiacao: 'Marcial', atkBonus: 2, text: 'O Aliado equipado recebe +2 de Ataque.'
  },
  {
  name: 'Manto de Couro', kind: 'equip', img: '/equip/layout-mantocouro.ai.png', cost: 1, classe: '', tipo: 'Equipamento', filiacao: 'Neutra', acBonus: 1, hpBonus: 1, text: 'O personagem equipado recebe +1 de Resistência e +1 de Vida.'
  },
  {
    name: 'Orbe de Absorção',
    kind: 'equip',
    img: '/equip/layout-orbeabsorcao.ai.png',
    cost: 2,
    classe: '',
    tipo: 'Equipamento',
    filiacao: 'Arcana',
    effect: 'draw_bonus',
    effectValue: 1,
    atkBonus: 0,
    text: 'Quando este equipamento entrar em campo, você pode\ndeslocar qualquer quantidade de cartas de Magia no\nseu cemitério. O personagem equipado, com esta carta,\nrecebe +1 de Ataque para cada carta deslocada por este\nefeito.'
  },
  {
    name: 'Redoma Santa', kind: 'equip', img: '/equip/layout-redomasanta.ai.png', cost: 5, classe: '', tipo: 'Equipamento', filiacao: 'Religioso', acBonus: 1, effect: 'redoma_santa', text: 'O personagem equipado recebe +1 de Resistência.\nQuando este equipamento entrar em campo, cure 3 de\nvida de um Aliado em campo.'
  },
  {
    name: 'Aranhas Negras, Quelíceras',
    kind: 'equip',
    img: '/equip/layout-aranhasqueliceras.ai.png',
    cost: 3,
    classe: '',
    tipo: 'Equipamento',
    filiacao: 'Sombras',
    effect: 'on_grave_damage_leader',
    effectValue: 2,
    atkBonus: 1,
    text: 'O Personagem recebe +1 de Ataque.\nQuando esta carta for enviada do campo para o\ncemitério, cause 2 de Dano ao Escolhido do oponente.'
  },
  {
    name: 'Tônico Revigorante', kind: 'spell', img: '/spell/layout-tonicorevigorante.ai.png', cost: 2, classe: '', tipo: 'Magia', filiacao: 'Arcana',
    escolha1: true, effectA: { type: 'heal', value: 3 }, effectB: { type: 'draw', value: 1 }, text: 'Escolha 1:\n• Escolha 1 personagem, cure 3 de vida dele.\n• Compre 1 carta.'
  },
   {
    name: 'Bem Treinado', kind: 'spell', img: '/spell/layout-bemtreinado.ai.png', 
    cost: 5,
    classe: '', tipo: 'Magia', filiacao: 'Marcial', escolha1: true,
    effectA: { type: 'exhaust_martial_to_displace_ally' }, effectB: { type: 'search_deck', query: {kind: 'spell', filiacao: 'Marcial'}, max:12, shuffleAfter: true }, text: 'Escolha 1:\n• Exaure um aliado "Marcial" que você controla, então\ndesloque 1 aliado do oponente.\n• Adicione 1 carta de magia "Marcial" do seu baralho\npara sua mão. Em seguida embaralhe seu baralho.'
  },
  {
  name: 'Fruto Abençoado', kind: 'spell', img: '/spell/layout-frutoabencoado.ai.png?v=20260426-1', cost: 0, classe: '', tipo: 'Magia', filiacao: 'Neutra', escolha1: true, resolveZone: 'banished',
    effectA: { type: 'heal', value: 1 },
    effectB: { type: 'fragment_back', value: 1 },
    text: 'Escolha 1:\n• Cure 1 de vida de um personagem no campo.\n• Recupere 1 Fragmento.\n\nDesloque esta carta após a resolução de seu efeito.'
  },
  {
    name: 'Invasão de Cativeiro', kind: 'spell', img: '/spell/layout-invasaocativeiro.ai.png', cost: 3, classe: '', tipo: 'Magia', filiacao: 'Neutra', escolha1: true,
    effectA: { type: 'tap_enemy_ally' },
    effectB: { type: 'atk_temp', value: 1 },
    text: 'Escolha 1:\n• Exaure 1 Aliado do oponente\n• Escolha 1 Aliado em campo, Ele Recebe +1 de Ataque\naté o fim do turno.'
  },
  {
    name: 'Quebra-Aço', kind: 'spell', img: '/spell/layout-quebraaco.ai.png', cost: 1, classe: '', tipo: 'Magia', filiacao: 'Neutra', effect: 'destroy_equip', text: 'Destrua 1 Equipamento em campo.'
  },
  {
    name: 'Sede de Vingança', kind: 'spell', img: '/spell/layout-sedevinganca.ai.png', cost: 5, classe: '', tipo: 'Magia', filiacao: 'Marcial', effect: 'sede_vinganca', effectValue: 3, text: 'Você pode ativar Sede de Vingança uma vez por turno.\nEscolha 1 personagem "Guerreiro" que você controla,\nele recebe +3 de ataque até o fim do turno. Se ele\nderrotar 1 aliado do oponente, neste turno, compre 1\ncarta.'
  },
  {
    name: 'Gladiador Implacável', kind: 'ally', img: '/allies/layout-gladiadorimplacavel.ai.png', cost: 4, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 0, hp: 5, maxHp: 5, damage: 3, atkBonus: 3, keywords: [], effect: 'buff_on_kill', effectValue: { atk: 1, ac: 1 }, text: 'Quando este Aliado vencer um inimigo em combate e\nenviá-lo para o cemitério, coloque 1 marcador\n"Sangue" neste aliado. Ele recebe +1 de Ataque e +1 de\nResistência para cada marcador Sangue nele.'
  },
  {
  name: 'Yohan, Ronin Vigilante', aliases: ['Yoran, Ronin Vigilante'], kind: 'ally', img: '/allies/layout-yohanronin.ai.png', cost: 2, classe: 'Guerreiro', tipo: 'Humano', filiacao: 'Marcial', ac: 0, hp: 3, maxHp: 3, damage: 1, atkBonus: 1, keywords: [], effect: 'kornex_buff_per_marcial_in_play', effectValue: 1, text: 'Este Aliado recebe +1 de ataque para cada outra carta\n"Marcial" no campo de qualquer jogador.'
  },
  {
    name: 'Livro Arcano Instável', kind: 'equip', img: '/equip/layout-livroinstavel.ai.png', cost: 2, classe: '', tipo: 'Equipamento', filiacao: 'Arcana', effect: 'olhar_topo', atkBonus: 1, text: 'O personagem equipado recebe +1 de Ataque.\nQuando este equipamento entrar em campo, olhe a\ncarta do topo do seu baralho. Volte-a para o topo ou\ncoloque-a no fundo do seu baralho.'
  },
  // Exemplo: carta que exige pagar vida de um aliado em vez de fragmentos
  {
    name: 'Aranhas Negras, Milícia', kind: 'spell', img: '/spell/layout-aranhasmilicia.ai.png', cost: 1, classe: '', tipo: 'Magia', filiacao: 'Sombras', effect: 'blood_sacrifice', costHp: 2, text: 'Cause 2 de dano em um Personagem que você controla.\nSe o fizer, cause 4 de dano em 1 Personagem inimigo.'
  },
   // Adicione todas as cartas reais aqui!
  {
    name: 'Pica-pau Agulheiro', kind: 'ally', img: '/allies/layout-picapauagulheiro.ai.png', cost: 2, classe: 'Criatura', tipo: 'Animal', filiacao: 'Neutra', ac: 0, hp: 3, maxHp: 3, damage: 2, atkBonus: 2, keywords: [],
    effect: 'damage_ally_on_enter', effectValue: 1, text: 'Quando este Aliado for convocado, você pode causar 1\nde dano a outro Aliado que você controla. Se o fizer,\ncompre 1 carta.'
  },
  
  // --- Cartas de exemplo para testar search_deck ---
 {
    name: 'Bom Fruto', kind: 'spell', img: '/spell/layout-bomfruto.ai.png?v=20260426-1', cost: 2, classe: '', tipo: 'Magia', filiacao: 'Religioso',
    effect: 'search_deck', query: { name: 'Fruto Abençoado' }, max: 12, title: 'Buscar Fruto Abençoado', shuffleAfter: true, text: 'Procure em seu baralho por 1 carta "Fruto Abençoado",\nrevele-a e coloque-a em sua mão. Embaralhe seu\nbaralho'
  },
  {
    name: 'Aranhas Negras, Observadora', kind: 'ally', img: '/allies/layout-aranhasobservadora.ai.png', cost: 1, classe: 'Cidadão', tipo: 'Elfo', filiacao: 'Sombras',
    ac: 0, hp: 2, maxHp: 2, damage: 1, atkBonus: 1,
    effect: 'aranhas_observadora', query: { name: 'Aranhas Negras' }, max: 15, shuffleAfter: true, text: 'Quando este Aliado for convocado, procure no seu\nbaralho uma carta com "Aranhas Negras" no nome e\nadicione-a à sua mão. O efeito de "Aranhas Negras,\nObservadora" só pode ser ativada uma vez por turno.'
  },
  {
    name: 'Troca de Energia', kind: 'spell', img: '/spell/layout-trocaenergia.ai.png', cost: 4, classe: '', tipo: 'Magia', filiacao: 'Religioso',
    effect: 'amizade_floresta', effectValue: { damageToAnimal: 2, healValue: 4 }, text: 'Escolha um aliado "Animal" que você controla. Cause 2\nde Dano no aliado escolhido, em seguida, cure 4 de vida\ndo seu Escolhido.'
  },
  // Cartão de teste para self_discard -> força o inimigo a descartar 1 carta aleatória
  {
    name: 'Aranhas Negras, Informante',
    kind: 'ally',
    img: '/allies/layout-aranhasinformante.ai.png',
    cost: 5,
    classe: 'Guerreiro',
    tipo: 'Humano',
    filiacao: 'Sombras',
    ac: 1,
    hp: 5,
    maxHp: 5,
    damage: 3,
    atkBonus: 3,
    keywords: [],
    effect: 'aranhas_informante',
    effectValue: { damage: 4, discard: 1 },
    text: 'Quando este Aliado for convocado, cause 4 de dano no\nseu Escolhido. Então, seu oponente descarta 1 carta\naleatória da mão dele.'
  },
];

if (typeof window !== 'undefined') {
  window.CARD_DEFS = CARD_DEFS;
  // Validador simples
  CARD_DEFS.forEach((card, idx) => {
    let missing = [];
    if (!('name' in card)) missing.push('name');
    if (!('kind' in card)) missing.push('kind');
    if (!('img' in card)) missing.push('img');
    if (!('classe' in card)) missing.push('classe');
    if (!('tipo' in card)) missing.push('tipo');
    if (!('filiacao' in card)) missing.push('filiacao');
    if (missing.length) {
      console.warn(`Carta ${idx} (${card.name||'sem nome'}): campos faltando:`, missing);
    }
  });
}
// Removido export para compatibilidade com <script> HTML

// Lista de efeitos customizados:
// - curar_animal: Ao entrar em campo, cura 1 de vida de um aliado do tipo Animal.
// - aura_hp: Aura que aumenta a vida máxima de aliados da Classe Cidadão.
// - buff_on_kill: Ao derrotar um inimigo, ganha bônus permanente.
// - olhar_topo: Revela a carta do topo do deck ao entrar em campo.
// - kornex_buff_per_marcial_in_play: Kornex Ronin ganha +1 ATK para cada outra carta Marcial em campo.
// - costHp: novo campo opcional que indica que o custo da carta deve ser pago com HP de um aliado (ex.: costHp: 2). O motor exibirá uma escolha de aliado/líder para pagar a vida antes de resolver a carta. Após o pagamento, a carta continua a ser resolvida normalmente (útil para efeitos como 'blood_sacrifice').
// Adicione novos efeitos aqui para referência e documentação.
