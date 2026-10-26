# Several devices (browser contexts with WebGL) per scenario: triple timeout
@slow
Feature: Device switch
  Whoever plays on the laptop takes the game along to the phone with a personal link and stays the same person.
  The key is only in the part after the "#" of the address and disappears from the address bar immediately.

  Background:
    Given Anna and Ben play a game in Switzerland
    And it is Anna's turn

  Scenario: Anna continues on the phone as the same person
    When Anna opens "Auf anderem Gerät weiterspielen" on the laptop
    Then the dialog shows a QR code and the hint "Dieser Link ist dein Platz – nicht weitergeben"
    When Anna opens her personal link on the phone
    Then Anna is in the game as "Anna (du)" on the phone
    And the address bar of Anna's phone contains no token
    And it is Anna's turn on the phone

  Scenario: The language Anna chose follows her to the phone
    When Anna selects the language "Lozärnerdütsch" in the game
    And Anna opens her personal link on the phone
    Then the phone shows the game in "Lozärnerdütsch"
    And the address bar of Anna's phone contains no token
    And the phone remembers "Lozärnerdütsch" after a reload

  Scenario: The French language follows Anna to the phone
    When Anna selects the language "Français" in the game
    And Anna opens her personal link on the phone
    Then the phone shows the game in "Français"
    And the address bar of Anna's phone contains no token
    And the phone remembers "Français" after a reload

  Scenario: After "Link erneuern" the old link no longer works
    When Anna opens "Auf anderem Gerät weiterspielen" on the laptop
    And Anna opens her personal link on the phone
    Then Anna is in the game as "Anna (du)" on the phone
    When Anna renews the link on the laptop
    Then Anna is still in the game as "Anna (du)" on the laptop
    And Anna's phone shows the message that the link does not work
    When Anna opens the old link on a new phone
    Then the new phone shows the message that the link does not work
    When Anna opens her new personal link on the phone
    Then Anna is in the game as "Anna (du)" on the phone

  Scenario: A link to a game that does not exist is explained
    When someone opens "#/resume/gibtsnicht/Zq3vN8aLk2Wd9XyTb7HfPm" on the phone
    Then the phone shows the message that the game has expired or does not exist

  Scenario: A broken link is explained instead of ignored
    When someone opens "#/resume/abc/kaputt" on the phone
    Then the phone shows the message that the link does not work
    And the phone offers the way back to the start page
