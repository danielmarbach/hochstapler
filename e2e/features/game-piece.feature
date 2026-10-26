Feature: Choosing a game piece
  Every player picks a piece of the country's set. A piece that somebody else holds cannot be picked.

  Scenario: The host picks a piece on the start page, a guest picks another one on the invitation
    When Anna creates a game in Switzerland with the piece "Käse" on the start page
    Then Anna has the piece "Käse" in the lobby
    When Anna copies the invite link
    And Ben opens the invite link
    Then Ben sees the piece "Käse" taken by "Anna"
    When Ben picks the piece "Sackmesser" and joins as "Ben"
    Then Anna sees the piece "Sackmesser" taken by "Ben" in the lobby
    And Anna cannot pick the piece "Sackmesser"
    When Anna starts the game
    Then Anna and Ben see the board with 2 players
    And in the game Anna plays the piece "cheese" and Ben the piece "swiss-knife"

  Scenario: A player changes the piece in the lobby and the others see it at once
    When Anna creates a game in Switzerland with a bot on the start page
    And Anna copies the invite link
    And Ben opens the invite link and joins as "Ben"
    And Ben picks the piece "Uhr" in the lobby
    Then Ben has the piece "Uhr" in the lobby
    And Anna sees the piece "Uhr" taken by "Ben" in the lobby
    And Anna cannot pick the piece "Uhr"
    When Ben picks the piece "Schokolade" in the lobby
    Then Anna sees the piece "Uhr" free in the lobby
